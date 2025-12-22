from __future__ import annotations

import json
import os
import queue
import signal
import threading
import time
from dataclasses import dataclass
from typing import Literal, Optional

import paho.mqtt.client as mqtt

from mfrc522 import SimpleMFRC522


MQTT_HOST = os.getenv("MQTT_HOST", "mqtt")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
READER_ID = os.getenv("RFID_READER_ID", "kiosk_1_reader_1")

# Default mode: what kind of scan we are expecting right now
DEFAULT_MODE = os.getenv("RFID_DEFAULT_MODE", "card")  # "card" | "tool"
PUBLISH_UID_ONLY = os.getenv("RFID_UID_ONLY", "1") == "1"  # publish UID as tag_id
POLL_DELAY_S = float(os.getenv("RFID_POLL_DELAY_S", "0.05"))

TOPIC_CMD_SET_MODE = "igen/cmd/rfid/set_mode"
TOPIC_CMD_WRITE = "igen/cmd/rfid/write"

TOPIC_EVT_CARD = "igen/evt/rfid/card_scan"
TOPIC_EVT_TOOL = "igen/evt/rfid/tool_scan"
TOPIC_EVT_WRITE = "igen/evt/rfid/write_result"


ScanMode = Literal["card", "tool"]


@dataclass
class WriteJob:
    request_id: str
    text: str


class RFIDService:
    def __init__(self) -> None:
        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message

        self._reader = SimpleMFRC522()
        self._running = False

        self._mode_lock = threading.Lock()
        self._mode: ScanMode = "card" if DEFAULT_MODE == "card" else "tool"

        self._write_q: "queue.Queue[WriteJob]" = queue.Queue()
        self._last_uid: Optional[int] = None
        self._last_pub_ts = 0.0

    # ---------- MQTT ----------
    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            print("[RFID] MQTT connected")
            client.subscribe(TOPIC_CMD_SET_MODE, qos=1)
            client.subscribe(TOPIC_CMD_WRITE, qos=1)
        else:
            print(f"[RFID] MQTT connect failed rc={reason_code}")

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        raw = msg.payload.decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"raw": raw}

        if topic == TOPIC_CMD_SET_MODE:
            mode = payload.get("mode")
            if mode in ("card", "tool"):
                with self._mode_lock:
                    self._mode = mode
                print(f"[RFID] mode set -> {mode}")
            return

        if topic == TOPIC_CMD_WRITE:
            rid = payload.get("request_id")
            text = payload.get("text")
            if not rid or not isinstance(text, str):
                print("[RFID] bad write cmd payload")
                return
            self._write_q.put(WriteJob(request_id=rid, text=text))
            print(f"[RFID] queued write request_id={rid}")
            return

    def publish(self, topic: str, payload: dict):
        self._client.publish(topic, json.dumps(payload), qos=1)

    # ---------- Main loop ----------
    def start(self):
        self._running = True
        self._client.connect(MQTT_HOST, MQTT_PORT, 60)
        self._client.loop_start()

        threading.Thread(target=self._write_loop, daemon=True).start()
        threading.Thread(target=self._read_loop, daemon=True).start()

        print(f"[RFID] started reader_id={READER_ID} default_mode={self._mode}")

    def stop(self):
        self._running = False
        try:
            self._client.loop_stop()
            self._client.disconnect()
        except Exception:
            pass

    # ---------- Read loop ----------
    def _read_loop(self):
     
        while self._running:
            try:
                uid, text = self._reader.read()  # blocks
                now = time.time()

                # debounce (same card held on reader)
                if self._last_uid == uid and (now - self._last_pub_ts) < 1.0:
                    continue
                self._last_uid = uid
                self._last_pub_ts = now

                with self._mode_lock:
                    mode = self._mode

                tag_id = str(uid) if PUBLISH_UID_ONLY else (text.strip() or str(uid))

                evt = {
                    "reader_id": READER_ID,
                    "mode": mode,            # "card" or "tool"
                    "uid": str(uid),
                    "tag_id": tag_id,
                    "text": text.strip(),
                    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }

                topic = TOPIC_EVT_CARD if mode == "card" else TOPIC_EVT_TOOL
                self.publish(topic, evt)
                print(f"[RFID] publish {topic}: uid={uid} tag_id={tag_id}")

                time.sleep(POLL_DELAY_S)

            except Exception as e:
                print(f"[RFID] read error: {e}")
                time.sleep(0.2)

    # ---------- Write loop ----------
    def _write_loop(self):
        while self._running:
            try:
                job = self._write_q.get(timeout=0.2)
            except queue.Empty:
                continue

            ok = True
            err = None
            try:
                # MFRC522 blocks have limited size; SimpleMFRC522 handles basic write.
                # Keep text short-ish; enforce on backend too.
                self._reader.write(job.text)
            except Exception as e:
                ok = False
                err = str(e)

            payload = {
                "reader_id": READER_ID,
                "request_id": job.request_id,
                "ok": ok,
                "error": err,
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            self.publish(TOPIC_EVT_WRITE, payload)
            print(f"[RFID] write_result request_id={job.request_id} ok={ok}")


def main():
    svc = RFIDService()

    def shutdown(*_):
        print("\n[RFID] stopping")
        svc.stop()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    svc.start()
    while True:
        time.sleep(1)


if __name__ == "__main__":
    main()
