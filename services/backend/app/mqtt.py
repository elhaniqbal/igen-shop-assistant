from __future__ import annotations

import json
import os
import time
import paho.mqtt.client as mqtt
from sqlalchemy import select

from .utils import with_db, mqtt_topic, dispatch_mqtt
from . import models
from .usecases.hw_events import apply_dispense_event, apply_return_event

MQTT_HOST = os.getenv("MQTT_HOST", "mqtt")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

SUB_TOPICS = [
    "igen/evt/dispense",
    "igen/evt/return",
    "igen/evt/rfid/card_scan",
    "igen/evt/rfid/tool_scan",
    "igen/evt/system/fault",
    "igen/evt/system/status",
]

class MqttBus:
    def __init__(self) -> None:
        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            print("[MQTT] connected")
            for t in SUB_TOPICS:
                client.subscribe(t, qos=1)
        else:
            print(f"[MQTT] connect failed rc={reason_code}")

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        raw = msg.payload.decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"raw": raw}

        _handle_mqtt_message(topic, payload)

    def start(self):
        for i in range(10):
            try:
                self._client.connect(MQTT_HOST, MQTT_PORT, 60)
                self._client.loop_start()
                print("[MQTT] loop started")
                return
            except Exception as e:
                print(f"[MQTT] retry {i+1}: {e}")
                time.sleep(2)
        print("[MQTT] failed to start")

    def stop(self):
        try:
            self._client.loop_stop()
            self._client.disconnect()
        except Exception:
            pass

    def publish(self, topic: str, payload: dict, qos: int = 1):
        self._client.publish(topic, json.dumps(payload), qos=qos)


@with_db
def _handle_mqtt_message(db, topic: str, payload: dict):
    # Always log raw MQTT events
    db.add(models.Event(event_type=f"mqtt:{topic}", payload_json=json.dumps(payload)))
    db.commit()

    # Dispatch to topic-specific handler if registered
    dispatch_mqtt(db, topic, payload)


# ---------- Topic handlers ----------

@mqtt_topic("igen/evt/dispense")
def handle_evt_dispense(db, payload: dict):
    request_id = payload.get("request_id")
    stage = payload.get("stage")
    if not request_id or not stage:
        return

    req = db.get(models.LoanRequest, request_id)
    if not req:
        return

    if stage == "accepted":
        req.hw_status = "accepted"
    elif stage == "in_progress":
        req.hw_status = "in_progress"
    elif stage == "succeeded":
        req.hw_status = "dispensed_ok"  # mechanical success only
    elif stage == "failed":
        req.hw_status = "failed"
        req.hw_error_code = payload.get("error_code")
        req.hw_error_reason = payload.get("error_reason")

    req.hw_updated_at = models.utcnow() if hasattr(models, "utcnow") else None
    db.commit()


@mqtt_topic("igen/evt/return")
def handle_evt_return(db, payload: dict):
    request_id = payload.get("request_id")
    stage = payload.get("stage")
    if not request_id or not stage:
        return

    req = db.get(models.LoanRequest, request_id)
    if not req:
        return

    if stage == "succeeded":
        req.hw_status = "return_ok"
        db.commit()

        loan = db.execute(
            select(models.Loan).where(
                models.Loan.user_id == req.user_id,
                models.Loan.tool_item_id == req.tool_item_id,
                models.Loan.returned_at.is_(None),
            )
        ).scalar_one_or_none()
        if loan:
            loan.returned_at = models.utcnow() if hasattr(models, "utcnow") else None
            loan.status = "returned"
            db.commit()

    elif stage == "failed":
        req.hw_status = "failed"
        req.hw_error_code = payload.get("error_code")
        req.hw_error_reason = payload.get("error_reason")
        db.commit()


@mqtt_topic("igen/evt/rfid/card_scan")
def handle_evt_card_scan(db, payload: dict):
    # Log-only for now. Implement auth flow later if you want MQTT-driven auth.
    pass


@mqtt_topic("igen/evt/rfid/tool_scan")
def handle_evt_tool_scan(db, payload: dict):
    # Optional: if your reader publishes tool scans via MQTT, you can auto-confirm here.
    # payload should include user_id OR you must infer current user session.
    pass


@mqtt_topic("igen/evt/system/fault")
def handle_evt_fault(db, payload: dict):
    # Log-only for now; later you can set a 'faults' table or status snapshot.
    pass


@mqtt_topic("igen/evt/system/status")
def handle_evt_status(db, payload: dict):
    # Heartbeat log; later you can store last-seen per node.
    pass


@mqtt_topic("igen/evt/dispense")
def handle_evt_dispense(db, payload: dict):
    apply_dispense_event(db, payload)

@mqtt_topic("igen/evt/return")
def handle_evt_return(db, payload: dict):
    apply_return_event(db, payload)