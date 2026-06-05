from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timedelta

from sqlalchemy import select

from ..db import SessionLocal
from .. import models
from .email_service import send_template

ALERT_POLL_INTERVAL_S = int(os.getenv("ALERT_POLL_INTERVAL_S", "60"))
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO", "")
STALE_UNCONFIRMED_MIN = int(os.getenv("STALE_UNCONFIRMED_MIN", "15"))


def utcnow() -> datetime:
    return datetime.now()


class AlertService:
    def __init__(self):
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _run(self):
        while not self._stop.wait(ALERT_POLL_INTERVAL_S):
            try:
                self._tick()
            except Exception as e:
                print(f"[ALERT_SERVICE] tick failed: {e}")

    def _tick(self):
        with SessionLocal() as db:
            self._check_overdue_loans(db)
            self._check_stale_unconfirmed(db)
            self._check_machine_alerts(db)

    def _emit_once(self, db, code: str, message: str, payload: dict):
        recent = db.execute(
            select(models.Event)
            .where(models.Event.event_type == f"alert:{code}")
            .order_by(models.Event.ts.desc())
            .limit(1)
        ).scalar_one_or_none()
        if recent and (utcnow() - recent.ts) < timedelta(minutes=30):
            return
        db.add(models.Event(
            event_type=f"alert:{code}",
            actor_type="system",
            payload_json=json.dumps(payload),
        ))
        db.commit()
        if ALERT_EMAIL_TO:
            try:
                send_template(
                    to=ALERT_EMAIL_TO,
                    template_name="alert_generic",
                    context={"code": code, "message": message, "payload": json.dumps(payload, indent=2)},
                )
            except Exception as e:
                print(f"[ALERT_SERVICE] email send failed: {e}")

    def _check_overdue_loans(self, db):
        count = db.execute(
            select(models.Loan)
            .where(models.Loan.returned_at.is_(None), models.Loan.due_at < utcnow(), models.Loan.status.in_(("active", "unconfirmed", "overdue")))
        ).scalars().all()
        if count:
            self._emit_once(db, "OVERDUE_LOANS", f"{len(count)} overdue loans detected", {"count": len(count)})

    def _check_stale_unconfirmed(self, db):
        cutoff = utcnow() - timedelta(minutes=STALE_UNCONFIRMED_MIN)
        rows = db.execute(
            select(models.Loan)
            .where(models.Loan.returned_at.is_(None), models.Loan.status == "unconfirmed", models.Loan.issued_at < cutoff)
        ).scalars().all()
        if rows:
            self._emit_once(db, "STALE_UNCONFIRMED", f"{len(rows)} stale unconfirmed loans detected", {"count": len(rows)})

    def _check_machine_alerts(self, db):
        row = db.execute(
            select(models.Event)
            .where(models.Event.event_type == "mqtt:igen/evt/machine/alert")
            .order_by(models.Event.ts.desc(), models.Event.event_id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if not row:
            return
        try:
            payload = json.loads(row.payload_json or "{}")
        except Exception:
            payload = {}
        sev = str(payload.get("severity", "")).lower()
        if sev in {"critical", "error"} and (utcnow() - row.ts) < timedelta(minutes=5):
            self._emit_once(db, "MACHINE_ALERT", payload.get("message", "Machine alert"), payload)
