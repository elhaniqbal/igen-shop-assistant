from __future__ import annotations

import json
import os
import random
import subprocess
import threading
import time
from dataclasses import dataclass, field
from functools import wraps
from typing import Callable, Dict, Optional
from urllib import error, parse, request

import paho.mqtt.client as mqtt

try:
    import serial  # type: ignore
except Exception:  # pragma: no cover
    serial = None


# ============================================================
# ENV / CONFIG
# ============================================================

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

BRIDGE_MODE = os.getenv("BRIDGE_MODE", "MOONRAKER").upper()
MOONRAKER_URL = os.getenv("MOONRAKER_URL", "http://host.docker.internal:7125").rstrip("/")

ENCODER_SERIAL_ENABLED = os.getenv("ENCODER_SERIAL_ENABLED", "0") == "1"
ENCODER_CONFIRM_ENABLED = os.getenv("ENCODER_CONFIRM_ENABLED", "0") == "1"
ENCODER_SIGN = int(os.getenv("ENCODER_SIGN", "1"))  # use -1 if encoder sign is flipped

SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyUSB0")
SERIAL_BAUD = int(os.getenv("SERIAL_BAUD", "115200"))
SERIAL_TIMEOUT_S = float(os.getenv("SERIAL_TIMEOUT_S", "1.5"))
ENCODER_TOLERANCE_DEG = float(os.getenv("ENCODER_TOLERANCE_DEG", "8.0"))

DONE_TIMEOUT_MS = int(os.getenv("DONE_TIMEOUT_MS", "30000"))
WAIT_IDLE = os.getenv("WAIT_IDLE", "1") == "1"
IDLE_POLL_INTERVAL_S = float(os.getenv("IDLE_POLL_INTERVAL_S", "0.35"))
MOONRAKER_HTTP_TIMEOUT_S = float(os.getenv("MOONRAKER_HTTP_TIMEOUT_S", "5.0"))

SIM_FAIL_RATE = float(os.getenv("SIM_FAIL_RATE", "0.08"))
SIM_MIN_TIME_S = float(os.getenv("SIM_MIN_TIME_S", "0.4"))
SIM_MAX_TIME_S = float(os.getenv("SIM_MAX_TIME_S", "1.5"))
SIM_ACK_DELAY_S = float(os.getenv("SIM_ACK_DELAY_S", "0.05"))

DEDUP_TTL_S = float(os.getenv("DEDUP_TTL_S", "120"))
IGNORE_RETAINED = os.getenv("IGNORE_RETAINED", "0") == "1"

DOOR_CONFIRM_TIMEOUT_S = float(os.getenv("DOOR_CONFIRM_TIMEOUT_S", "20"))
DEFAULT_HOME_MODE = os.getenv("DEFAULT_HOME_MODE", "python_assisted").lower()
VERTICAL_HOME_SCRIPT = os.getenv("VERTICAL_HOME_SCRIPT", "/app/scripts/vertical_home.py")

SLOTS_PER_CAKE = int(os.getenv("SLOTS_PER_CAKE", "6"))
DEG_PER_SLOT = float(os.getenv("DEG_PER_SLOT", "60.0"))

TOPIC_CMD_DISPENSE = "igen/cmd/dispense"
TOPIC_CMD_RETURN = "igen/cmd/return"
TOPIC_CMD_ADMIN_MANUAL = "igen/cmd/admin/manual"
TOPIC_CMD_ADMIN_MACHINE = "igen/cmd/admin/machine"
TOPIC_CMD_ADMIN_CAL = "igen/cmd/admin/calibration"
TOPIC_CMD_ADMIN_TEST_MOTOR = "igen/cmd/admin_test/motor"
TOPIC_CMD_HW_CONFIRM = "igen/cmd/hardware/confirm"
TOPIC_CMD_HW_CANCEL = "igen/cmd/hardware/cancel"

TOPIC_EVT_DISPENSE = "igen/evt/dispense"
TOPIC_EVT_RETURN = "igen/evt/return"
TOPIC_EVT_ADMIN_MANUAL = "igen/evt/admin/manual"
TOPIC_EVT_ADMIN_MACHINE = "igen/evt/admin/machine"
TOPIC_EVT_ADMIN_CAL = "igen/evt/admin/calibration"
TOPIC_EVT_ADMIN_TEST_MOTOR = "igen/evt/admin_test/motor"
TOPIC_EVT_MACHINE_ALERT = "igen/evt/machine/alert"
TOPIC_EVT_MACHINE_STATUS = "igen/evt/machine/status"
TOPIC_EVT_HW_WAIT = "igen/evt/hardware/wait"


# ============================================================
# DATA MODELS
# ============================================================

@dataclass(frozen=True)
class BridgeConfig:
    mode: str
    moonraker_url: str
    done_timeout_ms: int


@dataclass
class InFlight:
    request_id: str
    action: str
    started_at: float
    payload: dict


@dataclass
class PendingUserConfirm:
    request_id: str
    action: str
    stage: str
    created_at: float
    timeout_s: float
    event: threading.Event = field(default_factory=threading.Event)
    approved: Optional[bool] = None
    meta: dict = field(default_factory=dict)


@dataclass(frozen=True)
class RotationPlan:
    cake_id: int
    source_slot: int
    target_slot: int
    delta_slots: int
    direction: str
    expected_signed_deg: float
    script: str


CmdHandler = Callable[["Bridge2", dict], None]


# ============================================================
# ERRORS / HELPERS
# ============================================================

class BridgeError(Exception):
    def __init__(self, code: str, reason: str):
        super().__init__(reason)
        self.code = code
        self.reason = reason


def normalize_delta_deg(delta: float) -> float:
    while delta <= -180.0:
        delta += 360.0
    while delta > 180.0:
        delta -= 360.0
    return delta


def normalize_slot(slot: int) -> int:
    return slot % SLOTS_PER_CAKE


def signed_slot_delta(source: int, target: int) -> int:
    source = normalize_slot(source)
    target = normalize_slot(target)
    raw = target - source

    # Shortest wrapped path around a 6-slot cake
    if raw > SLOTS_PER_CAKE // 2:
        raw -= SLOTS_PER_CAKE
    elif raw < -(SLOTS_PER_CAKE // 2):
        raw += SLOTS_PER_CAKE

    return raw


def delta_to_direction(delta: int) -> str:
    if delta == 0:
        return "CW"
    return "CW" if delta > 0 else "CCW"


def build_rotation_script(cake_id: int, direction: str, slot_count: int) -> str:
    if slot_count <= 0:
        return ""

    macro = "MOVE_CAKE_CW_60" if direction == "CW" else "MOVE_CAKE_CCW_60"
    return "\n".join(f"{macro} CAKE={cake_id}" for _ in range(slot_count))


def build_rotation_plan(cake_id: int, source_slot: int, target_slot: int) -> RotationPlan:
    delta = signed_slot_delta(source_slot, target_slot)
    direction = delta_to_direction(delta)
    slot_count = abs(delta)
    expected_signed_deg = float(slot_count) * DEG_PER_SLOT
    if direction == "CCW":
        expected_signed_deg *= -1.0

    return RotationPlan(
        cake_id=cake_id,
        source_slot=normalize_slot(source_slot),
        target_slot=normalize_slot(target_slot),
        delta_slots=delta,
        direction=direction,
        expected_signed_deg=expected_signed_deg,
        script=build_rotation_script(cake_id, direction, slot_count),
    )


def cmd(topic: str):
    def deco(fn: CmdHandler) -> CmdHandler:
        Bridge2.CMD_HANDLERS[topic] = fn
        return fn
    return deco


def dedup_cmd(key_field: str = "request_id"):
    def deco(fn: CmdHandler) -> CmdHandler:
        @wraps(fn)
        def wrapped(self: "Bridge2", payload: dict):
            key = payload.get(key_field)
            if isinstance(key, str) and key and self._dedup_seen(key):
                print(f"[BRIDGE2] DUP ignored {fn.__name__} {key_field}={key}")
                return
            return fn(self, payload)
        return wrapped  # type: ignore
    return deco


def with_timeout(seconds: float):
    def deco(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            result = {}
            err = {}

            def run():
                try:
                    result["value"] = fn(*args, **kwargs)
                except Exception as e:
                    err["error"] = e

            t = threading.Thread(target=run, daemon=True)
            t.start()
            t.join(seconds)

            if t.is_alive():
                raise BridgeError("OP_TIMEOUT", f"{fn.__name__} timed out after {seconds:.1f}s")
            if "error" in err:
                raise err["error"]
            return result.get("value")
        return wrapped
    return deco


# ============================================================
# MOONRAKER CLIENT
# ============================================================

class MoonrakerClient:
    def __init__(self, base_url: str, http_timeout_s: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.http_timeout_s = http_timeout_s

    def _json_request(self, method: str, path: str, payload: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        data = None
        headers = {"Content-Type": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
        req = request.Request(url=url, data=data, headers=headers, method=method)
        try:
            with request.urlopen(req, timeout=self.http_timeout_s) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
            raise BridgeError("MOONRAKER_HTTP_ERROR", f"HTTP {e.code}: {body}")
        except error.URLError as e:
            raise BridgeError("KLIPPER_NOT_RESPONDING", f"Moonraker unreachable: {e}")
        except TimeoutError as e:
            raise BridgeError("KLIPPER_TIMEOUT", f"Moonraker timeout: {e}")
        except Exception as e:
            raise BridgeError("MOONRAKER_ERROR", f"Moonraker request failed: {e}")

    def get_server_info(self) -> dict:
        return self._json_request("GET", "/server/info")

    def get_printer_status(self) -> dict:
        query = parse.urlencode({
            "toolhead": "homed_axes,position",
            "idle_timeout": "state",
            "print_stats": "state,message",
        })
        return self._json_request("GET", f"/printer/objects/query?{query}")

    def send_gcode(self, script: str) -> dict:
        return self._json_request("POST", "/printer/gcode/script", {"script": script})

    def emergency_stop(self) -> dict:
        return self._json_request("POST", "/printer/emergency_stop", {})

    def firmware_restart(self) -> dict:
        return self._json_request("POST", "/printer/firmware_restart", {})

    def restart_service(self, service: str = "klipper") -> dict:
        return self._json_request("POST", "/machine/services/restart", {"service": service})

    def wait_until_idle(self, timeout_s: float, poll_interval_s: float = 0.35) -> dict:
        deadline = time.monotonic() + timeout_s
        last = {}
        while time.monotonic() < deadline:
            last = self.get_printer_status()
            status = last.get("result", {}).get("status", {})
            idle_state = str(status.get("idle_timeout", {}).get("state", "")).lower()
            print_state = str(status.get("print_stats", {}).get("state", "")).lower()
            if idle_state == "idle" and print_state not in {"error", "shutdown"}:
                return last
            time.sleep(poll_interval_s)
        raise BridgeError("KLIPPER_BUSY_TIMEOUT", f"Klipper did not become idle within {timeout_s:.1f}s")


# ============================================================
# ENCODER CLIENT
# ============================================================

class EncoderClient:
    def __init__(self, port: str, baud: int, timeout_s: float):
        if serial is None:
            raise BridgeError("SERIAL_LIB_MISSING", "pyserial is not installed")
        self.port = port
        self.baud = baud
        self.timeout_s = timeout_s
        self._lock = threading.Lock()
        self._ser = None

    def _ensure_open(self):
        if self._ser is None:
            try:
                self._ser = serial.Serial(
                    self.port,
                    self.baud,
                    timeout=self.timeout_s,
                    write_timeout=self.timeout_s,
                )
                time.sleep(0.2)
                self._ser.reset_input_buffer()
                self._ser.reset_output_buffer()
            except Exception as e:
                raise BridgeError("ENCODER_SERIAL_OPEN_FAIL", f"Could not open encoder serial port {self.port}: {e}")

    @with_timeout(max(2.0, SERIAL_TIMEOUT_S + 1.0))
    def _command(self, line: str) -> str:
        with self._lock:
            self._ensure_open()
            assert self._ser is not None
            self._ser.write((line.strip() + "\n").encode("utf-8"))
            self._ser.flush()
            raw = self._ser.readline().decode("utf-8", errors="replace").strip()
            if not raw:
                raise BridgeError("ENCODER_TIMEOUT", f"No encoder response for command: {line}")
            if raw.startswith("ERR "):
                raise BridgeError("ENCODER_ERR", raw)
            if not raw.startswith("OK "):
                raise BridgeError("ENCODER_BAD_REPLY", raw)
            return raw

    def status(self) -> str:
        return self._command("STATUS")

    def read_angle(self, cake_id: int) -> float:
        raw = self._command(f"READ cake={cake_id}")
        for p in raw.split():
            if p.startswith("adj_deg="):
                return float(p.split("=", 1)[1])
        raise BridgeError("ENCODER_PARSE_FAIL", f"Could not parse angle from: {raw}")

    def zero(self, cake_id: int) -> str:
        return self._command(f"ZERO cake={cake_id}")

    def set_zero(self, cake_id: int, deg: float) -> str:
        return self._command(f"SETZERO cake={cake_id} deg={deg:.3f}")

    def clear_zero(self, cake_id: int) -> str:
        return self._command(f"CLEARZERO cake={cake_id}")


# ============================================================
# BRIDGE
# ============================================================

class Bridge2:
    CMD_HANDLERS: Dict[str, CmdHandler] = {}

    def __init__(self, cfg: BridgeConfig):
        self.cfg = cfg
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

        self.moonraker = MoonrakerClient(cfg.moonraker_url, MOONRAKER_HTTP_TIMEOUT_S)
        self.encoder = EncoderClient(SERIAL_PORT, SERIAL_BAUD, SERIAL_TIMEOUT_S) if ENCODER_SERIAL_ENABLED else None

        self._seen: Dict[str, float] = {}
        self._seen_lock = threading.Lock()

        self._active: Optional[InFlight] = None
        self._active_lock = threading.Lock()

        self._pending_confirms: Dict[str, PendingUserConfirm] = {}
        self._pending_lock = threading.Lock()

        self._ts = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        self._sim_state = {
            "reachable": True,
            "state": "idle",
            "busy": False,
            "homed": False,
            "position": [0.0, 0.0, 50.0],
            "gantry1_position": 50.0,
            "gantry2_position": 50.0,
            "endstops": {"horizontal": False, "gantry1": False, "gantry2": False},
            "active_cake_id": None,
            "last_home_mode": DEFAULT_HOME_MODE,
        }

    # --------------------------------------------------------
    # Lifecycle
    # --------------------------------------------------------

    def connect(self):
        self.client.connect(MQTT_HOST, MQTT_PORT, 60)
        self.client.loop_start()
        print(f"[BRIDGE2] MQTT connected {MQTT_HOST}:{MQTT_PORT} mode={self.cfg.mode}")
        self._publish_machine_status({"boot": True})

    def close(self):
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass

    # --------------------------------------------------------
    # Dedup / active machine ownership
    # --------------------------------------------------------

    def _dedup_seen(self, request_id: str) -> bool:
        now = time.monotonic()
        with self._seen_lock:
            expired = [rid for rid, ts in self._seen.items() if (now - ts) > DEDUP_TTL_S]
            for rid in expired:
                self._seen.pop(rid, None)
            if request_id in self._seen:
                return True
            self._seen[request_id] = now
            return False

    def _try_claim_machine(self, request_id: str, action: str, payload: dict) -> bool:
        with self._active_lock:
            if self._active is not None:
                return False
            self._active = InFlight(request_id=request_id, action=action, started_at=time.monotonic(), payload=payload)
            return True

    def _release_machine(self, request_id: str):
        with self._active_lock:
            if self._active and self._active.request_id == request_id:
                self._active = None

    # --------------------------------------------------------
    # MQTT publish helpers
    # --------------------------------------------------------

    def _evt_topic(self, action: str) -> str:
        return {
            "dispense": TOPIC_EVT_DISPENSE,
            "return": TOPIC_EVT_RETURN,
            "admin_manual": TOPIC_EVT_ADMIN_MANUAL,
            "admin_machine": TOPIC_EVT_ADMIN_MACHINE,
            "admin_calibration": TOPIC_EVT_ADMIN_CAL,
            "admin_test_motor": TOPIC_EVT_ADMIN_TEST_MOTOR,
        }[action]

    def _publish(self, topic: str, payload: dict):
        self.client.publish(topic, json.dumps(payload), qos=1)

    def _publish_stage(
        self,
        action: str,
        request_id: str,
        stage: str,
        *,
        error_code: Optional[str] = None,
        error_reason: Optional[str] = None,
        details: Optional[dict] = None,
    ):
        payload = {
            "request_id": request_id,
            "event": f"{action}_status",
            "stage": stage,
            "error_code": error_code,
            "error_reason": error_reason,
            "ts": self._ts(),
        }
        if details:
            payload.update(details)
        self._publish(self._evt_topic(action), payload)

    def _publish_alert(
        self,
        *,
        code: str,
        message: str,
        severity: str = "error",
        related_request_id: Optional[str] = None,
        data: Optional[dict] = None,
    ):
        payload = {
            "alert_id": f"alert_{int(time.time() * 1000)}_{random.randint(1000, 9999)}",
            "severity": severity,
            "style": "black" if severity == "critical" else "red" if severity == "error" else "amber",
            "source": "bridge2",
            "code": code,
            "message": message,
            "sticky": severity in {"critical", "error"},
            "ack_required": severity in {"critical", "error"},
            "related_request_id": related_request_id,
            "data": data or {},
            "ts": self._ts(),
        }
        self._publish(TOPIC_EVT_MACHINE_ALERT, payload)

    def _publish_wait(self, request_id: str, action: str, stage: str, timeout_s: float, details: Optional[dict] = None):
        payload = {
            "request_id": request_id,
            "action": action,
            "stage": stage,
            "timeout_s": timeout_s,
            "ts": self._ts(),
        }
        if details:
            payload.update(details)
        self._publish(TOPIC_EVT_HW_WAIT, payload)

    # --------------------------------------------------------
    # Input validation helpers
    # --------------------------------------------------------

    def _require_int(self, payload: dict, key: str) -> int:
        if key not in payload:
            raise BridgeError("BAD_PAYLOAD", f"missing required field: {key}")
        return int(payload[key])

    # --------------------------------------------------------
    # SIM helpers
    # --------------------------------------------------------

    def _sim_vertical_tilted(self) -> bool:
        e = self._sim_state["endstops"]
        return bool(e.get("gantry1")) != bool(e.get("gantry2"))

    def _sim_set_horizontal_home(self):
        self._sim_state["position"][0] = 0.0
        self._sim_state["endstops"]["horizontal"] = True

    def _sim_set_vertical_home(self, side: str):
        key = "gantry1" if side == "left" else "gantry2"
        pos_key = "gantry1_position" if side == "left" else "gantry2_position"
        self._sim_state[pos_key] = 0.0
        self._sim_state["position"][2] = min(self._sim_state["gantry1_position"], self._sim_state["gantry2_position"])
        self._sim_state["endstops"][key] = True

    def _sim_mark_homed(self):
        e = self._sim_state["endstops"]
        self._sim_state["homed"] = bool(e.get("horizontal")) and bool(e.get("gantry1")) and bool(e.get("gantry2"))

    def _sim_apply_vertical_jog(self, delta: float, axis: str = "both"):
        if axis in {"both", "gantry1"}:
            self._sim_state["gantry1_position"] = max(0.0, float(self._sim_state["gantry1_position"]) + delta)
            self._sim_state["endstops"]["gantry1"] = self._sim_state["gantry1_position"] <= 0.0
        if axis in {"both", "gantry2"}:
            self._sim_state["gantry2_position"] = max(0.0, float(self._sim_state["gantry2_position"]) + delta)
            self._sim_state["endstops"]["gantry2"] = self._sim_state["gantry2_position"] <= 0.0
        self._sim_state["position"][2] = min(self._sim_state["gantry1_position"], self._sim_state["gantry2_position"])
        self._sim_mark_homed()

    def _sim_apply_horizontal_jog(self, delta: float):
        self._sim_state["position"][0] = max(0.0, float(self._sim_state["position"][0]) + delta)
        self._sim_state["endstops"]["horizontal"] = self._sim_state["position"][0] <= 0.0
        self._sim_mark_homed()

    # --------------------------------------------------------
    # Status / MQTT callbacks
    # --------------------------------------------------------

    def _publish_machine_status(self, extra: Optional[dict] = None):
        if self.cfg.mode == "SIM":
            e = dict(self._sim_state["endstops"])
            payload = {
                "reachable": True,
                "state": self._sim_state["state"],
                "homed": self._sim_state["homed"],
                "busy": self._sim_state["busy"],
                "position": list(self._sim_state["position"]),
                "horizontal_position": self._sim_state["position"][0],
                "vertical_position": self._sim_state["position"][2],
                "active_cake_id": self._sim_state.get("active_cake_id"),
                "klipper_state": self._sim_state["state"],
                "klipper_state_message": None,
                "endstops": e,
                "vertical_tilted": self._sim_vertical_tilted(),
                "encoder_serial_enabled": ENCODER_SERIAL_ENABLED,
                "encoder_confirm_enabled": ENCODER_CONFIRM_ENABLED,
                "simulated": True,
                "ts": self._ts(),
            }
            if extra:
                payload.update(extra)
            self._publish(TOPIC_EVT_MACHINE_STATUS, payload)
            return

        try:
            st = self._query_machine_status()
            payload = {
                "reachable": True,
                "state": st["print_state"],
                "homed": st["homed"],
                "busy": not st["idle"],
                "position": st["position"],
                "klipper_state_message": st["print_message"],
                "encoder_serial_enabled": ENCODER_SERIAL_ENABLED,
                "encoder_confirm_enabled": ENCODER_CONFIRM_ENABLED,
                "ts": self._ts(),
            }
            if extra:
                payload.update(extra)
            self._publish(TOPIC_EVT_MACHINE_STATUS, payload)
        except Exception as e:
            self._publish(TOPIC_EVT_MACHINE_STATUS, {
                "reachable": False,
                "state": "unknown",
                "homed": False,
                "busy": False,
                "error": str(e),
                "encoder_serial_enabled": ENCODER_SERIAL_ENABLED,
                "encoder_confirm_enabled": ENCODER_CONFIRM_ENABLED,
                "ts": self._ts(),
            })

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            return
        for t in self.CMD_HANDLERS.keys():
            client.subscribe(t, qos=1)

    def _on_message(self, client, userdata, msg):
        if IGNORE_RETAINED and getattr(msg, "retain", False):
            return
        try:
            payload = json.loads(msg.payload.decode("utf-8", errors="replace"))
        except Exception:
            return
        handler = self.CMD_HANDLERS.get(msg.topic)
        if handler:
            handler(self, payload)

    # --------------------------------------------------------
    # Machine status / motion execution
    # --------------------------------------------------------

    def _query_machine_status(self) -> dict:
        resp = self.moonraker.get_printer_status()
        status = resp.get("result", {}).get("status", {})
        homed_axes = str(status.get("toolhead", {}).get("homed_axes", ""))
        return {
            "homed": set("xyz").issubset(set(homed_axes)),
            "position": status.get("toolhead", {}).get("position"),
            "idle": str(status.get("idle_timeout", {}).get("state", "")).lower() == "idle",
            "print_state": str(status.get("print_stats", {}).get("state", "")).lower(),
            "print_message": status.get("print_stats", {}).get("message"),
        }

    def _ensure_machine_ready(self) -> dict:
        self.moonraker.get_server_info()
        st = self._query_machine_status()
        if st["print_state"] in {"error", "shutdown"}:
            raise BridgeError("KLIPPER_IN_ERROR_STATE", f"Klipper state={st['print_state']} message={st['print_message']}")
        return st

    def _wait_idle_if_needed(self):
        if WAIT_IDLE:
            self.moonraker.wait_until_idle(self.cfg.done_timeout_ms / 1000.0, IDLE_POLL_INTERVAL_S)

    @with_timeout(max(5.0, MOONRAKER_HTTP_TIMEOUT_S + 5.0))
    def _run_gcode(self, request_id: str, script: str):
        self.moonraker.send_gcode(script)
        self._wait_idle_if_needed()

    @with_timeout(70.0)
    def _run_vertical_home_script(self):
        try:
            proc = subprocess.run(
                ["python3", VERTICAL_HOME_SCRIPT],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise BridgeError("VERT_HOME_TIMEOUT", "Python-assisted vertical home timed out")
        except Exception as e:
            raise BridgeError("VERT_HOME_SCRIPT_FAIL", f"Could not launch vertical home script: {e}")

        if proc.returncode != 0:
            raise BridgeError(
                "VERT_HOME_SCRIPT_FAIL",
                f"Vertical home script failed rc={proc.returncode} stderr={proc.stderr.strip()} stdout={proc.stdout.strip()}",
            )

    def _home_machine(self, request_id: str, mode: str):
        mode = (mode or DEFAULT_HOME_MODE).lower()
        if mode == "python_assisted":
            # Keeping your existing intended behavior.
            self._run_gcode(request_id, "SA_HOME_HORIZONTAL")
            self._run_vertical_home_script()
            self._run_gcode(request_id, "SET_GCODE_VARIABLE MACRO=SA_STATE VARIABLE=homed VALUE=1")
            return
        if mode == "true_synced":
            self._run_gcode(request_id, "SA_HOME_MACHINE")
            return
        if mode == "manual_independent":
            raise BridgeError("MANUAL_HOME_REQUIRED", "manual_independent home must be performed through explicit left/right admin commands")
        raise BridgeError("BAD_PAYLOAD", f"unsupported home mode: {mode}")

    # --------------------------------------------------------
    # Slot-based plan building
    # --------------------------------------------------------

    def _build_dispense_plan(self, payload: dict) -> RotationPlan:
        cake_id = self._require_int(payload, "cake_id")
        current_slot = self._require_int(payload, "current_slot")
        target_slot = self._require_int(payload, "target_slot")
        return build_rotation_plan(cake_id, current_slot, target_slot)

    def _build_return_plan(self, payload: dict) -> RotationPlan:
        cake_id = self._require_int(payload, "cake_id")
        current_slot = self._require_int(payload, "current_slot")
        target_slot = self._require_int(payload, "target_slot")
        return build_rotation_plan(cake_id, current_slot, target_slot)

    # --------------------------------------------------------
    # Encoder-aware rotation execution
    # --------------------------------------------------------

    def _read_encoder_angle_if_enabled(self, cake_id: int) -> Optional[float]:
        if not ENCODER_CONFIRM_ENABLED:
            return None
        if not self.encoder:
            raise BridgeError("ENCODER_DISABLED", "Encoder confirmation is enabled but serial encoder client is unavailable")
        return self.encoder.read_angle(cake_id)

    def _verify_rotation_plan(
        self,
        request_id: str,
        plan: RotationPlan,
        before_deg: Optional[float],
        after_deg: Optional[float],
    ):
        if before_deg is None or after_deg is None:
            return

        raw_delta = normalize_delta_deg(after_deg - before_deg)
        actual_signed_deg = raw_delta * ENCODER_SIGN
        expected_signed_deg = plan.expected_signed_deg

        if abs(actual_signed_deg - expected_signed_deg) > ENCODER_TOLERANCE_DEG:
            self._publish_alert(
                code="ENCODER_MISMATCH",
                message=(
                    f"Cake {plan.cake_id} rotation mismatch: "
                    f"expected {expected_signed_deg:.1f} deg got {actual_signed_deg:.2f} deg"
                ),
                severity="warning",
                related_request_id=request_id,
                data={
                    "cake_id": plan.cake_id,
                    "source_slot": plan.source_slot,
                    "target_slot": plan.target_slot,
                    "direction": plan.direction,
                    "expected_deg": expected_signed_deg,
                    "actual_deg": actual_signed_deg,
                    "tolerance_deg": ENCODER_TOLERANCE_DEG,
                },
            )

    def _execute_rotation_plan(self, request_id: str, plan: RotationPlan):
        if plan.delta_slots == 0:
            return

        before = self._read_encoder_angle_if_enabled(plan.cake_id)
        self._run_gcode(request_id, plan.script)
        after = self._read_encoder_angle_if_enabled(plan.cake_id)
        self._verify_rotation_plan(request_id, plan, before, after)

    # --------------------------------------------------------
    # User confirm flow
    # --------------------------------------------------------

    def _dispatch_async(self, target, *args):
        threading.Thread(target=target, args=args, daemon=True).start()

    def _register_user_confirm(self, request_id: str, action: str, stage: str, timeout_s: float, meta: Optional[dict] = None):
        pending = PendingUserConfirm(
            request_id=request_id,
            action=action,
            stage=stage,
            created_at=time.monotonic(),
            timeout_s=timeout_s,
            meta=meta or {},
        )
        with self._pending_lock:
            self._pending_confirms[request_id] = pending
        self._publish_wait(request_id, action, stage, timeout_s, details=meta or {})
        return pending

    def _resolve_user_confirm(self, request_id: str, approved: bool):
        with self._pending_lock:
            pending = self._pending_confirms.get(request_id)
            if not pending:
                raise BridgeError("NO_PENDING_CONFIRM", f"No pending confirmation for request_id={request_id}")
            pending.approved = approved
            pending.event.set()

    def _wait_for_user_confirm(self, request_id: str, action: str, stage: str, timeout_s: float, meta: Optional[dict] = None):
        pending = self._register_user_confirm(request_id, action, stage, timeout_s, meta)
        ok = pending.event.wait(timeout_s)
        with self._pending_lock:
            self._pending_confirms.pop(request_id, None)

        if not ok:
            raise BridgeError("USER_CONFIRM_TIMEOUT", f"Timed out waiting for user confirmation at stage={stage}")
        if pending.approved is not True:
            raise BridgeError("USER_CONFIRM_REJECTED", f"User cancelled request at stage={stage}")

    # --------------------------------------------------------
    # Generic simulate helper
    # --------------------------------------------------------

    def _simulate(self, action: str, payload: dict):
        rid = str(payload["request_id"])
        self._publish_stage(action, rid, "accepted")

        def run():
            time.sleep(SIM_ACK_DELAY_S)
            self._publish_stage(action, rid, "in_progress")
            time.sleep(SIM_MIN_TIME_S + random.random() * (SIM_MAX_TIME_S - SIM_MIN_TIME_S))
            if random.random() >= SIM_FAIL_RATE:
                self._publish_stage(action, rid, "succeeded")
            else:
                self._publish_stage(action, rid, "failed", error_code="SIM_FAIL", error_reason="simulated failure")

        threading.Thread(target=run, daemon=True).start()

    # --------------------------------------------------------
    # SIM admin manual / machine / motor test
    # --------------------------------------------------------

    def _simulate_admin_manual(self, payload: dict):
        rid = str(payload["request_id"])
        action = str(payload.get("action", "")).lower()
        try:
            self._publish_stage("admin_manual", rid, "accepted")
            self._publish_stage("admin_manual", rid, "in_progress")

            if action == "home_machine":
                self._sim_state["last_home_mode"] = str(payload.get("home_mode", DEFAULT_HOME_MODE))
                self._sim_set_horizontal_home()
                self._sim_set_vertical_home("left")
                self._sim_set_vertical_home("right")
                self._sim_state["state"] = "idle"
                self._sim_mark_homed()
            elif action == "home_horizontal":
                self._sim_set_horizontal_home()
            elif action == "home_vertical_left":
                self._sim_set_vertical_home("left")
            elif action == "home_vertical_right":
                self._sim_set_vertical_home("right")
            elif action == "move_to_door":
                self._sim_state["state"] = "idle"
            elif action == "move_to_cake":
                self._sim_state["active_cake_id"] = int(payload.get("cake_id", 0) or 0)
            elif action == "move_cake":
                self._sim_state["active_cake_id"] = int(payload.get("cake_id", 0) or 0)
            elif action == "jog_axis":
                axis = str(payload.get("axis", "")).lower()
                direction = str(payload.get("direction", "")).lower()
                dist = float(payload.get("distance", payload.get("step", 0)))
                signed = dist if direction in {"positive", "right", "up"} else -dist

                if axis in {"gantry", "vertical", "vertical_sync"}:
                    self._sim_apply_vertical_jog(signed, "both")
                elif axis == "vertical_left":
                    self._sim_apply_vertical_jog(signed, "gantry1")
                elif axis == "vertical_right":
                    self._sim_apply_vertical_jog(signed, "gantry2")
                elif axis == "horizontal":
                    self._sim_apply_horizontal_jog(signed)
                else:
                    raise BridgeError("BAD_PAYLOAD", f"unsupported jog axis in sim: {axis}")

            self._publish_stage("admin_manual", rid, "succeeded")
            self._publish_machine_status({"last_request_id": rid})
        except BridgeError as e:
            self._publish_stage("admin_manual", rid, "failed", error_code=e.code, error_reason=e.reason)
            self._publish_alert(code=e.code, message=e.reason, severity="error", related_request_id=rid)

    def _simulate_admin_machine(self, payload: dict):
        rid = str(payload["request_id"])
        action = str(payload.get("action", "")).lower()

        self._publish_stage("admin_machine", rid, "accepted")
        self._publish_stage("admin_machine", rid, "in_progress")

        if action == "query_status":
            self._publish_machine_status({"last_request_id": rid})
        elif action == "emergency_stop":
            self._sim_state["busy"] = False
            self._sim_state["state"] = "stopped"
            self._publish_machine_status({"last_request_id": rid})
        elif action in {"restart_klipper", "firmware_restart"}:
            self._sim_state["state"] = "idle"
            self._publish_machine_status({"last_request_id": rid})

        self._publish_stage("admin_machine", rid, "succeeded")

    def _sleep_with_log(self, request_id: str, seconds: float, reason: str):
        print(f"[BRIDGE2][RID={request_id}] sleep {seconds:.1f}s reason={reason}")
        time.sleep(seconds)

    def _simulate_motor_test(self, payload: dict):
        request_id = str(payload["request_id"])
        motor_id = int(payload.get("motor_id"))
        action_name = str(payload.get("action", "")).lower()
        self._publish_motor_test_stage(request_id, motor_id, action_name, "accepted")

        def run():
            self._publish_motor_test_stage(request_id, motor_id, action_name, "in_progress")
            self._sim_state["active_cake_id"] = motor_id

            if action_name == "dispense":
                self._sleep_with_log(request_id, 0.6, "sim move to cake")
                self._sleep_with_log(request_id, 0.6, "sim rotate")
                self._sleep_with_log(request_id, 0.6, "sim move to door")
                self._sleep_with_log(request_id, 5.0, "sim door dwell")
                self._sleep_with_log(request_id, 0.6, "sim park from door")
            elif action_name == "return":
                self._sleep_with_log(request_id, 0.6, "sim move to door")
                self._sleep_with_log(request_id, 5.0, "sim door dwell")
                self._sleep_with_log(request_id, 0.6, "sim move to cake")
                self._sleep_with_log(request_id, 0.6, "sim rotate")
                self._sleep_with_log(request_id, 0.6, "sim park from cake")
            else:
                self._publish_motor_test_stage(
                    request_id,
                    motor_id,
                    action_name,
                    "failed",
                    error_code="BAD_PAYLOAD",
                    error_reason=f"unsupported motor test action: {action_name}",
                )
                return

            self._publish_motor_test_stage(request_id, motor_id, action_name, "succeeded")
            self._publish_machine_status({"last_request_id": request_id, "active_cake_id": motor_id})

        threading.Thread(target=run, daemon=True).start()

    # --------------------------------------------------------
    # Main dispense / return execution
    # --------------------------------------------------------

    def _execute_request(self, action: str, payload: dict):
        request_id = str(payload["request_id"])

        if not self._try_claim_machine(request_id, action, payload):
            self._publish_stage(action, request_id, "failed", error_code="BUSY", error_reason="machine busy")
            return

        try:
            self._publish_stage(action, request_id, "accepted")

            st = self._ensure_machine_ready()
            if not st["homed"]:
                raise BridgeError("MACHINE_UNHOMED", "Klipper reports machine is not homed")

            self._publish_stage(action, request_id, "in_progress")

            if action == "dispense":
                plan = self._build_dispense_plan(payload)

                self._publish_stage(
                    action,
                    request_id,
                    "move_to_cake",
                    details={
                        "cake_id": plan.cake_id,
                        "source_slot": plan.source_slot,
                        "target_slot": plan.target_slot,
                    },
                )
                self._run_gcode(request_id, f"SA_MOVE_TO_CAKE CAKE={plan.cake_id}")

                self._publish_stage(
                    action,
                    request_id,
                    "rotate_cake",
                    details={
                        "cake_id": plan.cake_id,
                        "direction": plan.direction,
                        "source_slot": plan.source_slot,
                        "target_slot": plan.target_slot,
                    },
                )
                self._execute_rotation_plan(request_id, plan)

                self._publish_stage(action, request_id, "move_to_door")
                self._run_gcode(request_id, "SA_MOVE_TO_DOOR")

                self._publish_stage(action, request_id, "waiting_user_confirm")
                self._wait_for_user_confirm(
                    request_id,
                    action,
                    "door_take_confirm",
                    DOOR_CONFIRM_TIMEOUT_S,
                    {"message": "Waiting for user to take tool and confirm"},
                )

                self._publish_stage(action, request_id, "park")
                self._run_gcode(request_id, "SA_PARK_FROM_DOOR")

            elif action == "return":
                plan = self._build_return_plan(payload)

                self._publish_stage(action, request_id, "move_to_door")
                self._run_gcode(request_id, "SA_MOVE_TO_DOOR")

                self._publish_stage(action, request_id, "waiting_user_confirm")
                self._wait_for_user_confirm(
                    request_id,
                    action,
                    "door_insert_confirm",
                    DOOR_CONFIRM_TIMEOUT_S,
                    {"message": "Waiting for user to insert tool and confirm"},
                )

                self._publish_stage(
                    action,
                    request_id,
                    "move_to_cake",
                    details={
                        "cake_id": plan.cake_id,
                        "source_slot": plan.source_slot,
                        "target_slot": plan.target_slot,
                    },
                )
                self._run_gcode(request_id, f"SA_MOVE_TO_CAKE CAKE={plan.cake_id}")

                self._publish_stage(
                    action,
                    request_id,
                    "rotate_cake",
                    details={
                        "cake_id": plan.cake_id,
                        "direction": plan.direction,
                        "source_slot": plan.source_slot,
                        "target_slot": plan.target_slot,
                    },
                )
                self._execute_rotation_plan(request_id, plan)

                self._publish_stage(action, request_id, "park")
                self._run_gcode(request_id, "SA_PARK_FROM_CAKE")

            else:
                raise BridgeError("BAD_PAYLOAD", f"unsupported action: {action}")

            self._publish_stage(action, request_id, "succeeded")
            self._publish_machine_status()

        except BridgeError as e:
            self._publish_stage(action, request_id, "failed", error_code=e.code, error_reason=e.reason)
            self._publish_alert(
                code=e.code,
                message=e.reason,
                severity="critical" if e.code.startswith("KLIPPER") else "error",
                related_request_id=request_id,
            )
        except Exception as e:
            self._publish_stage(action, request_id, "failed", error_code="UNEXPECTED", error_reason=str(e))
            self._publish_alert(code="UNEXPECTED", message=str(e), severity="error", related_request_id=request_id)
        finally:
            self._release_machine(request_id)

    # --------------------------------------------------------
    # Admin motor test
    # --------------------------------------------------------

    def _publish_motor_test_stage(
        self,
        request_id: str,
        motor_id: int,
        action_name: str,
        stage: str,
        *,
        error_code: Optional[str] = None,
        error_reason: Optional[str] = None,
    ):
        payload = {
            "request_id": request_id,
            "motor_id": motor_id,
            "action": action_name,
            "event": "admin_motor_test_status",
            "stage": stage,
            "error_code": error_code,
            "error_reason": error_reason,
            "ts": self._ts(),
        }
        self._publish(TOPIC_EVT_ADMIN_TEST_MOTOR, payload)

    def _execute_motor_test(self, payload: dict):
        request_id = str(payload["request_id"])
        motor_id = int(payload.get("motor_id"))
        action_name = str(payload.get("action", "")).lower()

        if not self._try_claim_machine(request_id, "admin_test_motor", payload):
            self._publish_motor_test_stage(request_id, motor_id, action_name, "failed", error_code="BUSY", error_reason="machine busy")
            return

        try:
            self._publish_motor_test_stage(request_id, motor_id, action_name, "accepted")

            st = self._ensure_machine_ready()
            if not st["homed"]:
                raise BridgeError("MACHINE_UNHOMED", "Klipper reports machine is not homed")

            self._publish_motor_test_stage(request_id, motor_id, action_name, "in_progress")

            if action_name == "dispense":
                # Default test path: 0 -> 1
                plan = build_rotation_plan(motor_id, 0, 1)
                self._run_gcode(request_id, f"SA_MOVE_TO_CAKE CAKE={motor_id}")
                self._execute_rotation_plan(request_id, plan)
                self._run_gcode(request_id, "SA_MOVE_TO_DOOR")
                self._sleep_with_log(request_id, 5.0, "test dispense door dwell")
                self._run_gcode(request_id, "SA_PARK_FROM_DOOR")

            elif action_name == "return":
                # Default test path: 1 -> 0
                plan = build_rotation_plan(motor_id, 1, 0)
                self._run_gcode(request_id, "SA_MOVE_TO_DOOR")
                self._sleep_with_log(request_id, 5.0, "test return door dwell")
                self._run_gcode(request_id, f"SA_MOVE_TO_CAKE CAKE={motor_id}")
                self._execute_rotation_plan(request_id, plan)
                self._run_gcode(request_id, "SA_PARK_FROM_CAKE")

            else:
                raise BridgeError("BAD_PAYLOAD", f"unsupported motor test action: {action_name}")

            self._publish_motor_test_stage(request_id, motor_id, action_name, "succeeded")
            self._publish_machine_status({"last_request_id": request_id, "active_cake_id": motor_id})

        except BridgeError as e:
            self._publish_motor_test_stage(request_id, motor_id, action_name, "failed", error_code=e.code, error_reason=e.reason)
            self._publish_alert(code=e.code, message=e.reason, severity="error", related_request_id=request_id)
        except Exception as e:
            self._publish_motor_test_stage(request_id, motor_id, action_name, "failed", error_code="UNEXPECTED", error_reason=str(e))
            self._publish_alert(code="UNEXPECTED", message=str(e), severity="error", related_request_id=request_id)
        finally:
            self._release_machine(request_id)

    # --------------------------------------------------------
    # Admin manual
    # --------------------------------------------------------

    def _execute_admin_manual(self, payload: dict):
        rid = str(payload["request_id"])
        action = str(payload.get("action", "")).lower()

        try:
            self._publish_stage("admin_manual", rid, "accepted")

            if action == "home_machine":
                self._home_machine(rid, str(payload.get("home_mode", DEFAULT_HOME_MODE)))

            elif action == "home_vertical_left":
                self._run_gcode(rid, "SA_HOME_VERTICAL_LEFT")

            elif action == "home_vertical_right":
                self._run_gcode(rid, "SA_HOME_VERTICAL_RIGHT")

            elif action == "home_horizontal":
                self._run_gcode(rid, "SA_HOME_HORIZONTAL")

            elif action == "set_homed":
                self._run_gcode(rid, f"SET_GCODE_VARIABLE MACRO=SA_STATE VARIABLE=homed VALUE={int(payload.get('value', 1))}")

            elif action == "move_to_door":
                self._run_gcode(rid, "SA_MOVE_TO_DOOR")

            elif action == "move_to_cake":
                self._run_gcode(rid, f"SA_MOVE_TO_CAKE CAKE={self._require_int(payload, 'cake_id')}")

            elif action == "move_cake":
                cake_id = self._require_int(payload, "cake_id")
                current_slot = self._require_int(payload, "current_slot")
                target_slot = self._require_int(payload, "target_slot")
                plan = build_rotation_plan(cake_id, current_slot, target_slot)
                self._execute_rotation_plan(rid, plan)

                self._publish_alert(
                    code="CAKE_MOVED_MANUALLY",
                    message=f"Cake {cake_id} moved manually",
                    severity="warning",
                    related_request_id=rid,
                    data={
                        "cake_id": cake_id,
                        "source_slot": plan.source_slot,
                        "target_slot": plan.target_slot,
                        "direction": plan.direction,
                    },
                )

            elif action == "set_cake_zero":
                cake_id = self._require_int(payload, "cake_id")
                if self.encoder:
                    self.encoder.zero(cake_id)
                self._run_gcode(rid, f"SA_CAKE_SET_ZERO CAKE={cake_id}")

            elif action == "jog_axis":
                axis = str(payload.get("axis", "")).lower()
                direction = str(payload.get("direction", "")).lower()
                dist = float(payload.get("distance", payload.get("step", 0)))

                if axis in {"gantry", "vertical", "vertical_sync"} and direction in {"up", "positive"}:
                    self._run_gcode(rid, f"SA_JOG_GANTRY_UP DIST={dist}")
                elif axis in {"gantry", "vertical", "vertical_sync"} and direction in {"down", "negative"}:
                    self._run_gcode(rid, f"SA_JOG_GANTRY_DOWN DIST={dist}")
                elif axis == "vertical_left" and direction in {"up", "positive"}:
                    self._run_gcode(rid, f"SA_JOG_GANTRY1_UP DIST={dist}")
                elif axis == "vertical_left" and direction in {"down", "negative"}:
                    self._run_gcode(rid, f"SA_JOG_GANTRY1_DOWN DIST={dist}")
                elif axis == "vertical_right" and direction in {"up", "positive"}:
                    self._run_gcode(rid, f"SA_JOG_GANTRY2_UP DIST={dist}")
                elif axis == "vertical_right" and direction in {"down", "negative"}:
                    self._run_gcode(rid, f"SA_JOG_GANTRY2_DOWN DIST={dist}")
                elif axis == "horizontal" and direction in {"left", "negative"}:
                    self._run_gcode(rid, f"SA_JOG_HORIZ_LEFT DIST={dist}")
                elif axis == "horizontal" and direction in {"right", "positive"}:
                    self._run_gcode(rid, f"SA_JOG_HORIZ_RIGHT DIST={dist}")
                else:
                    raise BridgeError("BAD_PAYLOAD", f"unsupported jog axis/direction axis={axis} direction={direction}")

            else:
                raise BridgeError("BAD_PAYLOAD", f"unsupported admin manual action: {action}")

            self._publish_stage("admin_manual", rid, "succeeded")
            self._publish_machine_status()

        except BridgeError as e:
            self._publish_stage("admin_manual", rid, "failed", error_code=e.code, error_reason=e.reason)
            self._publish_alert(code=e.code, message=e.reason, severity="error", related_request_id=rid)

    # --------------------------------------------------------
    # Admin machine
    # --------------------------------------------------------

    def _execute_admin_machine(self, payload: dict):
        rid = str(payload["request_id"])
        action = str(payload.get("action", "")).lower()

        try:
            self._publish_stage("admin_machine", rid, "accepted")

            if action == "query_status":
                extra = {}
                if self.encoder:
                    try:
                        extra["encoder_status"] = self.encoder.status()
                    except Exception as e:
                        extra["encoder_status_error"] = str(e)
                self._publish_machine_status(extra=extra)

            elif action == "restart_klipper":
                self.moonraker.restart_service("klipper")

            elif action == "firmware_restart":
                self.moonraker.firmware_restart()

            elif action == "emergency_stop":
                self.moonraker.emergency_stop()

            else:
                raise BridgeError("BAD_PAYLOAD", f"unsupported admin machine action: {action}")

            self._publish_stage("admin_machine", rid, "succeeded")

        except BridgeError as e:
            self._publish_stage("admin_machine", rid, "failed", error_code=e.code, error_reason=e.reason)
            self._publish_alert(code=e.code, message=e.reason, severity="error", related_request_id=rid)

    # --------------------------------------------------------
    # Admin calibration
    # --------------------------------------------------------

    def _execute_admin_cal(self, payload: dict):
        rid = str(payload["request_id"])
        action = str(payload.get("action", "")).lower()

        try:
            self._publish_stage("admin_calibration", rid, "accepted")

            if action == "set_variable":
                self._run_gcode(rid, f"SAVE_VARIABLE VARIABLE={payload['variable']} VALUE={payload['value']}")

            elif action in {"set_door_x", "set_door_distance"}:
                self._run_gcode(rid, f"SA_SET_DOOR_X VALUE={payload['value']}")

            elif action == "set_door_z":
                self._run_gcode(rid, f"SA_SET_DOOR_Z VALUE={payload['value']}")

            elif action in {"set_cake_center", "set_cake_center_x"}:
                cake_id = self._require_int(payload, "cake_id")
                self._run_gcode(rid, f"SA_SET_CAKE_CENTER_X CAKE={cake_id} VALUE={payload['value']}")

            elif action == "encoder_set_zero":
                if not self.encoder:
                    raise BridgeError("ENCODER_DISABLED", "encoder serial client is not enabled")
                self.encoder.set_zero(self._require_int(payload, "cake_id"), float(payload["deg"]))

            elif action == "encoder_clear_zero":
                if not self.encoder:
                    raise BridgeError("ENCODER_DISABLED", "encoder serial client is not enabled")
                self.encoder.clear_zero(self._require_int(payload, "cake_id"))

            else:
                raise BridgeError("BAD_PAYLOAD", f"unsupported admin calibration action: {action}")

            self._publish_stage("admin_calibration", rid, "succeeded")

        except BridgeError as e:
            self._publish_stage("admin_calibration", rid, "failed", error_code=e.code, error_reason=e.reason)
            self._publish_alert(code=e.code, message=e.reason, severity="error", related_request_id=rid)


# ============================================================
# MQTT COMMAND HANDLERS
# ============================================================

@cmd(TOPIC_CMD_DISPENSE)
@dedup_cmd("request_id")
def handle_dispense(self: Bridge2, payload: dict):
    if self.cfg.mode == "SIM":
        self._simulate("dispense", payload)
    else:
        self._dispatch_async(self._execute_request, "dispense", payload)


@cmd(TOPIC_CMD_RETURN)
@dedup_cmd("request_id")
def handle_return(self: Bridge2, payload: dict):
    if self.cfg.mode == "SIM":
        self._simulate("return", payload)
    else:
        self._dispatch_async(self._execute_request, "return", payload)


@cmd(TOPIC_CMD_ADMIN_MANUAL)
@dedup_cmd("request_id")
def handle_admin_manual(self: Bridge2, payload: dict):
    if self.cfg.mode == "SIM":
        self._simulate_admin_manual(payload)
    else:
        self._dispatch_async(self._execute_admin_manual, payload)


@cmd(TOPIC_CMD_ADMIN_MACHINE)
@dedup_cmd("request_id")
def handle_admin_machine(self: Bridge2, payload: dict):
    if self.cfg.mode == "SIM":
        self._simulate_admin_machine(payload)
    else:
        self._dispatch_async(self._execute_admin_machine, payload)


@cmd(TOPIC_CMD_ADMIN_CAL)
@dedup_cmd("request_id")
def handle_admin_cal(self: Bridge2, payload: dict):
    if self.cfg.mode == "SIM":
        self._simulate("admin_calibration", payload)
        self._publish_machine_status({"last_request_id": str(payload.get("request_id"))})
    else:
        self._dispatch_async(self._execute_admin_cal, payload)


@cmd(TOPIC_CMD_ADMIN_TEST_MOTOR)
@dedup_cmd("request_id")
def handle_admin_test_motor(self: Bridge2, payload: dict):
    if self.cfg.mode == "SIM":
        self._simulate_motor_test(payload)
    else:
        self._dispatch_async(self._execute_motor_test, payload)


@cmd(TOPIC_CMD_HW_CONFIRM)
@dedup_cmd("request_id")
def handle_hw_confirm(self: Bridge2, payload: dict):
    request_id = str(payload["request_id"])
    try:
        self._resolve_user_confirm(request_id, True)
    except BridgeError as e:
        self._publish_alert(code=e.code, message=e.reason, severity="warning", related_request_id=request_id)


@cmd(TOPIC_CMD_HW_CANCEL)
@dedup_cmd("request_id")
def handle_hw_cancel(self: Bridge2, payload: dict):
    request_id = str(payload["request_id"])
    try:
        self._resolve_user_confirm(request_id, False)
    except BridgeError as e:
        self._publish_alert(code=e.code, message=e.reason, severity="warning", related_request_id=request_id)


# ============================================================
# MAIN
# ============================================================

def main():
    cfg = BridgeConfig(mode=BRIDGE_MODE, moonraker_url=MOONRAKER_URL, done_timeout_ms=DONE_TIMEOUT_MS)
    b = Bridge2(cfg)
    b.connect()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        b.close()


if __name__ == "__main__":
    main()