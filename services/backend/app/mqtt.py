from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta

import paho.mqtt.client as mqtt
from sqlalchemy import select

from .utils import with_db, mqtt_topic, dispatch_mqtt
from . import models
from .motor_test_store import set_motor_test_status
from .usecases.user_flow import build_hw_payload

MQTT_HOST = os.getenv("MQTT_HOST", "mqtt")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

SUB_TOPICS = [
    "igen/evt/dispense",
    "igen/evt/return",
    "igen/evt/rfid/card_scan",
    "igen/evt/rfid/tool_scan",
    "igen/evt/system/fault",
    "igen/evt/system/status",
    "igen/evt/admin_test/motor",
    "igen/evt/cake/home",
    "igen/evt/machine/alert",
    "igen/evt/machine/status",
    "igen/evt/admin/manual",
    "igen/evt/admin/machine",
    "igen/evt/admin/calibration",
]


def _now() -> datetime:
    return datetime.now()


def _publish(topic: str, payload: dict, qos: int = 1):
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    c.connect(MQTT_HOST, MQTT_PORT, 60)
    c.loop_start()
    try:
        c.publish(topic, json.dumps(payload), qos=qos)
        time.sleep(0.1)
    finally:
        c.loop_stop()
        c.disconnect()


def _release_next_request_in_batch(db, batch_id: str, request_type: str, finished_request_id: str):
    rows = db.execute(
        select(models.LoanRequest)
        .where(models.LoanRequest.batch_id == batch_id)
        .order_by(models.LoanRequest.created_at.asc(), models.LoanRequest.request_id.asc())
    ).scalars().all()
    if not rows:
        return

    finished_seen = False
    for row in rows:
        if row.request_id == finished_request_id:
            finished_seen = True
            continue
        if not finished_seen:
            continue
        if row.hw_status == "pending":
            payload = build_hw_payload(db, row.request_id)
            topic = "igen/cmd/dispense" if request_type == "dispense" else "igen/cmd/return"
            _publish(topic, payload, qos=1)
            return


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
                self._client.connect(MQTT_HOST, MQTT_PORT)
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
    db.add(models.Event(event_type=f"mqtt:{topic}", payload_json=json.dumps(payload)))
    db.commit()
    dispatch_mqtt(db, topic, payload)


@mqtt_topic("igen/evt/admin_test/motor")
def handle_evt_admin_test_motor(db, payload: dict):
    request_id = payload.get("request_id")
    stage = payload.get("stage")
    if not request_id or not stage:
        return
    set_motor_test_status(request_id, {
        "request_id": request_id,
        "stage": stage,
        "motor_id": payload.get("motor_id"),
        "action": payload.get("action"),
        "error_code": payload.get("error_code"),
        "error_reason": payload.get("error_reason"),
    })


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
        req.hw_status = "dispensed_ok"
    elif stage == "failed":
        req.hw_status = "failed"
        req.hw_error_code = payload.get("error_code")
        req.hw_error_reason = payload.get("error_reason")

    req.hw_updated_at = _now()
    db.commit()

    if stage == "succeeded":
        existing_loan = db.execute(
            select(models.Loan).where(
                models.Loan.user_id == req.user_id,
                models.Loan.tool_item_id == req.tool_item_id,
                models.Loan.returned_at.is_(None),
            ).order_by(models.Loan.issued_at.desc())
        ).scalar_one_or_none()

        if not existing_loan:
            hours = req.loan_period_hours or 24
            due_at = _now() + timedelta(hours=hours)
            loan_id = models.new_id("loan")
            db.add(models.Loan(
                loan_id=loan_id,
                user_id=req.user_id,
                tool_item_id=req.tool_item_id,
                issued_at=_now(),
                due_at=due_at,
                confirmed_at=None,
                returned_at=None,
                status="unconfirmed",
            ))
            db.add(models.Event(
                event_type="loan:created_unconfirmed",
                actor_type="system",
                actor_id=req.user_id,
                request_id=req.request_id,
                tool_item_id=req.tool_item_id,
                payload_json=json.dumps({"reason": "dispensed_ok_requires_confirm"}),
            ))
            db.commit()

    if stage in {"succeeded", "failed"}:
        _release_next_request_in_batch(db, req.batch_id, "dispense", req.request_id)


@mqtt_topic("igen/evt/return")
def handle_evt_return(db, payload: dict):
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
        req.hw_status = "return_ok"
    elif stage == "failed":
        req.hw_status = "failed"
        req.hw_error_code = payload.get("error_code")
        req.hw_error_reason = payload.get("error_reason")

    req.hw_updated_at = _now()
    db.commit()

    if stage == "succeeded":
        loan = db.execute(
            select(models.Loan).where(
                models.Loan.user_id == req.user_id,
                models.Loan.tool_item_id == req.tool_item_id,
                models.Loan.returned_at.is_(None),
            )
        ).scalar_one_or_none()
        if loan:
            loan.returned_at = _now()
            loan.status = "returned"
            db.add(models.Event(
                event_type="loan:returned",
                actor_type="system",
                actor_id=req.user_id,
                request_id=req.request_id,
                tool_item_id=req.tool_item_id,
                payload_json="{}",
            ))
            db.commit()

    if stage in {"succeeded", "failed"}:
        _release_next_request_in_batch(db, req.batch_id, "return", req.request_id)


@mqtt_topic("igen/evt/rfid/card_scan")
def handle_evt_card_scan(db, payload: dict):
    reader_id = payload.get("reader_id")
    from .routers.rfid import _rfid_set
    _rfid_set(reader_id, "card", payload)


@mqtt_topic("igen/evt/rfid/tool_scan")
def handle_evt_tool_scan(db, payload: dict):
    reader_id = payload.get("reader_id", "unknown")
    from .routers.rfid import _rfid_set
    _rfid_set(reader_id, "tool", payload)


@mqtt_topic("igen/evt/system/fault")
def handle_evt_fault(db, payload: dict):
    return


@mqtt_topic("igen/evt/system/status")
def handle_evt_status(db, payload: dict):
    return


@mqtt_topic("igen/evt/machine/alert")
def handle_evt_machine_alert(db, payload: dict):
    return


@mqtt_topic("igen/evt/machine/status")
def handle_evt_machine_status(db, payload: dict):
    return


@mqtt_topic("igen/evt/admin/manual")
def handle_evt_admin_manual(db, payload: dict):
    return


@mqtt_topic("igen/evt/admin/machine")
def handle_evt_admin_machine(db, payload: dict):
    return


@mqtt_topic("igen/evt/admin/calibration")
def handle_evt_admin_calibration(db, payload: dict):
    return


from .cake_cmd_store import set_cake_cmd_status

@mqtt_topic("igen/evt/cake/home")
def handle_evt_cake_home(db, payload: dict):
    request_id = payload.get("request_id")
    stage = payload.get("stage")
    if not request_id or not stage:
        return
    set_cake_cmd_status(request_id, {
        "request_id": request_id,
        "cake_id": payload.get("cake_id"),
        "stage": stage,
        "error_code": payload.get("error_code"),
        "error_reason": payload.get("error_reason"),
    })
