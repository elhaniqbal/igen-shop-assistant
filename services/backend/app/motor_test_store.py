# backend/motor_test_store.py
from __future__ import annotations

import threading
from typing import Optional


_MOTOR_TEST_LOCK = threading.Lock()
_MOTOR_TEST: dict[str, dict] = {}


def set_motor_test_status(request_id: str, patch: dict) -> None:
    with _MOTOR_TEST_LOCK:
        cur = _MOTOR_TEST.get(request_id, {"request_id": request_id})
        cur.update(patch)
        _MOTOR_TEST[request_id] = cur


def get_motor_test_status(request_id: str) -> Optional[dict]:
    with _MOTOR_TEST_LOCK:
        return _MOTOR_TEST.get(request_id)
