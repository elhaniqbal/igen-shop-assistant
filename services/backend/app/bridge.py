# backend/bridge/bridge.py
#
# MQTT <-> Serial Bridge for IGEN Shop Assistant
#
# Modes:
#   BRIDGE_MODE=SERIAL  -> talks to real ESP32 over USB serial
#   BRIDGE_MODE=SIM     -> simulates hardware workflow (for laptop testing)
#
# MQTT topics:
#   Subscribes:
#     igen/cmd/dispense
#     igen/cmd/return
#   Publishes:
#     igen/evt/dispense
#     igen/evt/return
#
# Serial protocol (Bridge -> ESP32):
#   DISPENSE <request_id> <slot_id>\n
#   RETURN   <request_id> <slot_id>\n
#
# Serial protocol (ESP32 -> Bridge):
#   ACK <request_id>\n
#   DISPENSE_OK <request_id>\n
#   DISPENSE_FAIL <request_id> <error_code>\n
#   RETURN_OK <request_id>\n
#   RETURN_FAIL <request_id> <error_code>\n
#
# Timeouts:
#   - ACK_TIMEOUT_MS: must receive ACK within this time
#   - DONE_TIMEOUT_MS: must receive OK/FAIL within this time

from __future__ import annotations

import json
import os
import random
import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, Optional

import paho.mqtt.client as mqtt

try:
    import serial  # pyserial installs the "serial" module
except Exception:
    serial = None


# ---------- ENV / CONFIG ----------
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

MODE = os.getenv("BRIDGE_MODE", "SIM").upper()  # SIM or SERIAL
SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyUSB0")
SERIAL_BAUD = int(os.getenv("SERIAL_BAUD", "115200"))

ACK_TIMEOUT_MS = int(os.getenv("ACK_TIMEOUT_MS", "500"))
DONE_TIMEOUT_MS = int(os.getenv("DONE_TIMEOUT_MS", "30000"))

SIM_FAIL_RATE = float(os.getenv("SIM_FAIL_RATE", "0.08"))
SIM_MIN_TIME_S = float(os.getenv("SIM_MIN_TIME_S", "0.4"))
SIM_MAX_TIME_S = float(os.getenv("SIM_MAX_TIME_S", "1.5"))
SIM_ACK_DELAY_S = float(os.getenv("SIM_ACK_DELAY_S", "0.05"))

TOPIC_CMD_DISPENSE = "igen/cmd/dispense"
TOPIC_CMD_RETURN = "igen/cmd/return"
TOPIC_EVT_DISPENSE = "igen/evt/dispense"
TOPIC_EVT_RETURN = "igen/evt/return"


# ---------- DATA ----------
@dataclass(frozen=True)
class BridgeConfig:
    mode: str
    serial_port: str
    serial_baud: int
    ack_timeout_ms: int
    done_timeout_ms: int


@dataclass
class Pending:
    action: str  # "dispense" | "return"
    acked: bool = False
    ack_timer: Optional[threading.Timer] = None
    done_timer: Optional[threading.Timer] = None


# ---------- DECORATOR REGISTRY ----------
CmdHandler = Callable[["Bridge", dict], None]


def cmd(topic: str) -> Callable[[CmdHandler], CmdHandler]:
    """Decorator to register a command handler for an MQTT topic."""
    def deco(fn: CmdHandler) -> CmdHandler:
        Bridge.CMD_HANDLERS[topic] = fn
        return fn
    return deco


# ---------- BRIDGE ----------
class Bridge:
    CMD_HANDLERS: Dict[str, CmdHandler] = {}

    def __init__(self, cfg: BridgeConfig):
        self.cfg = cfg

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

        self.ser: Optional["serial.Serial"] = None
        self._running = False
        self._rx_thread: Optional[threading.Thread] = None

        self._pending: Dict[str, Pending] = {}
        self._lock = threading.Lock()

        self._evt_topic = lambda action: TOPIC_EVT_DISPENSE if action == "dispense" else TOPIC_EVT_RETURN
        self._ts = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # ---- lifecycle ----
    def connect(self):
        self.client.connect(MQTT_HOST, MQTT_PORT, 60)
        self.client.loop_start()
        print(f"[BRIDGE] MQTT connected {MQTT_HOST}:{MQTT_PORT} mode={self.cfg.mode}")

        self._running = True
        if self.cfg.mode == "SERIAL":
            if serial is None:
                raise RuntimeError("pyserial not installed; pip install pyserial")

            self.ser = serial.Serial(self.cfg.serial_port, self.cfg.serial_baud, timeout=0.2)
            print(f"[BRIDGE] Serial opened {self.cfg.serial_port} @ {self.cfg.serial_baud}")
            self._start_serial_reader()

    def close(self):
        self._running = False
        self._clear_pending()

        try:
            if self.ser:
                self.ser.close()
        except Exception:
            pass

        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass

    # ---- mqtt callbacks ----
    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            print(f"[BRIDGE] MQTT connect failed rc={reason_code}")
            return

        print("[BRIDGE] MQTT subscribe OK")
        for t in self.CMD_HANDLERS.keys():
            client.subscribe(t, qos=1)

    def _on_message(self, client, userdata, msg):
        raw = msg.payload.decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            print(f"[BRIDGE] Bad JSON on {msg.topic}: {raw}")
            return

        handler = self.CMD_HANDLERS.get(msg.topic)
        if not handler:
            print(f"[BRIDGE] No handler for topic: {msg.topic}")
            return

        handler(self, payload)

    # ---- mqtt publish ----
    def _publish(self, topic: str, payload: dict):
        self.client.publish(topic, json.dumps(payload), qos=1)
        print(f"[BRIDGE] MQTT pub {topic}: {payload}")

    def _publish_stage(self, action: str, request_id: str, stage: str,
                       error_code: Optional[str] = None, error_reason: Optional[str] = None):
        self._publish(self._evt_topic(action), {
            "request_id": request_id,
            "event": f"{action}_status",
            "stage": stage,
            "error_code": error_code,
            "error_reason": error_reason,
            "ts": self._ts(),
        })

    # ---- pending timers ----
    def _start_pending(self, action: str, request_id: str):
        self._finish_pending(request_id)  # cancel any old timers if reused id

        p = Pending(action=action)

        def ack_timeout():
            with self._lock:
                cur = self._pending.get(request_id)
                if not cur or cur.acked is True:
                    return
                self._pending.pop(request_id, None)
            self._publish_stage(action, request_id, "failed", "TIMEOUT_ACK",
                                f"no ACK within {self.cfg.ack_timeout_ms}ms")

        def done_timeout():
            with self._lock:
                cur = self._pending.pop(request_id, None)
                if not cur:
                    return
            self._publish_stage(action, request_id, "failed", "TIMEOUT_DONE",
                                f"no completion within {self.cfg.done_timeout_ms}ms")

        p.ack_timer = threading.Timer(self.cfg.ack_timeout_ms / 1000.0, ack_timeout)
        p.done_timer = threading.Timer(self.cfg.done_timeout_ms / 1000.0, done_timeout)

        with self._lock:
            self._pending[request_id] = p

        p.ack_timer.start()
        p.done_timer.start()

    def _mark_acked(self, request_id: str) -> Optional[str]:
        with self._lock:
            p = self._pending.get(request_id)
            if not p:
                return None
            p.acked = True
            if p.ack_timer:
                p.ack_timer.cancel()
            return p.action

    def _finish_pending(self, request_id: str) -> Optional[str]:
        with self._lock:
            p = self._pending.pop(request_id, None)
        if not p:
            return None
        if p.ack_timer:
            p.ack_timer.cancel()
        if p.done_timer:
            p.done_timer.cancel()
        return p.action

    def _clear_pending(self):
        with self._lock:
            vals = list(self._pending.values())
            self._pending.clear()
        for p in vals:
            if p.ack_timer:
                p.ack_timer.cancel()
            if p.done_timer:
                p.done_timer.cancel()

    # ---- serial I/O ----
    def _start_serial_reader(self):
        assert self.ser is not None

        def reader():
            print("[BRIDGE] Serial reader thread started")
            while self._running:
                try:
                    line = self.ser.readline().decode("utf-8", errors="replace").strip()
                    if line:
                        self._handle_serial_line(line)
                except Exception as e:
                    print(f"[BRIDGE] Serial read error: {e}")
                    time.sleep(0.2)

        self._rx_thread = threading.Thread(target=reader, daemon=True)
        self._rx_thread.start()

    def _serial_send(self, line: str):
        if not self.ser:
            self._publish_stage("dispense", "unknown", "failed", "SERIAL_NOT_READY", "serial not open")
            print("[BRIDGE] Serial not open")
            return
        try:
            self.ser.write(line.encode("utf-8"))
            self.ser.flush()
            print(f"[BRIDGE] ->SER {line.strip()}")
        except Exception as e:
            print(f"[BRIDGE] Serial write error: {e}")

    def _handle_serial_line(self, line: str):
        # ACK <rid>
        # DISPENSE_OK <rid>
        # DISPENSE_FAIL <rid> <err>
        # RETURN_OK <rid>
        # RETURN_FAIL <rid> <err>
        print(f"[BRIDGE] SER-> {line}")
        parts = line.split()
        if len(parts) < 2:
            return

        tag, rid = parts[0], parts[1]
        err = parts[2] if len(parts) >= 3 else None

        if tag == "ACK":
            action = self._mark_acked(rid)
            if action:
                self._publish_stage(action, rid, "in_progress")
            return

        # final states
        if tag in ("DISPENSE_OK", "DISPENSE_FAIL", "RETURN_OK", "RETURN_FAIL"):
            self._finish_pending(rid)

        if tag == "DISPENSE_OK":
            self._publish_stage("dispense", rid, "succeeded")
        elif tag == "DISPENSE_FAIL":
            self._publish_stage("dispense", rid, "failed", err or "UNKNOWN", "hardware reported failure")
        elif tag == "RETURN_OK":
            self._publish_stage("return", rid, "succeeded")
        elif tag == "RETURN_FAIL":
            self._publish_stage("return", rid, "failed", err or "UNKNOWN", "hardware reported failure")

    # ---- simulation ----
    def _simulate(self, action: str, request_id: str):
        def run():
            time.sleep(SIM_ACK_DELAY_S)
            self._handle_serial_line(f"ACK {request_id}")

            # deterministic-ish cycle time: stable per request_id
            base = SIM_MIN_TIME_S + (abs(hash(request_id)) % 1000) / 1000.0 * (SIM_MAX_TIME_S - SIM_MIN_TIME_S)
            time.sleep(base)

            ok = random.random() >= SIM_FAIL_RATE
            if ok:
                self._handle_serial_line(("DISPENSE_OK" if action == "dispense" else "RETURN_OK") + f" {request_id}")
            else:
                err = random.choice(["JAM_GANTRY", "ENC_MISMATCH", "SENSOR_FAIL", "BUSY"])
                self._handle_serial_line(("DISPENSE_FAIL" if action == "dispense" else "RETURN_FAIL") + f" {request_id} {err}")

        threading.Thread(target=run, daemon=True).start()


# ---------- MQTT COMMAND HANDLERS ----------
@cmd(TOPIC_CMD_DISPENSE)
def handle_dispense(self: Bridge, payload: dict):
    rid = payload.get("request_id")
    slot_id = payload.get("slot_id")  # keep slot_id as the serial argument
    if not rid or not slot_id:
        print("[BRIDGE] dispense cmd missing request_id/slot_id")
        return

    self._publish_stage("dispense", rid, "accepted")
    self._start_pending("dispense", rid)

    if self.cfg.mode == "SIM":
        self._simulate("dispense", rid)
    else:
        self._serial_send(f"DISPENSE {rid} {slot_id}\n")


@cmd(TOPIC_CMD_RETURN)
def handle_return(self: Bridge, payload: dict):
    rid = payload.get("request_id")
    slot_id = payload.get("slot_id")
    if not rid or not slot_id:
        print("[BRIDGE] return cmd missing request_id/slot_id")
        return

    self._publish_stage("return", rid, "accepted")
    self._start_pending("return", rid)

    if self.cfg.mode == "SIM":
        self._simulate("return", rid)
    else:
        self._serial_send(f"RETURN {rid} {slot_id}\n")


def main():
    cfg = BridgeConfig(
        mode=MODE,
        serial_port=SERIAL_PORT,
        serial_baud=SERIAL_BAUD,
        ack_timeout_ms=ACK_TIMEOUT_MS,
        done_timeout_ms=DONE_TIMEOUT_MS,
    )

    b = Bridge(cfg)
    b.connect()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[BRIDGE] stopping")
    finally:
        b.close()


if __name__ == "__main__":
    main()
