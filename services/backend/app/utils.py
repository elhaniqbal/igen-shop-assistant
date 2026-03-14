from __future__ import annotations

import json
from functools import wraps
from typing import Any, Callable, Dict, Optional, Tuple

from .db import SessionLocal
from . import models

Handler = Callable[..., Any]
MqttHandler = Callable[[Any, dict], None]  # (db, payload) -> None

MQTT_REGISTRY: Dict[str, MqttHandler] = {}


def with_db(fn: Handler) -> Handler:
    """Open/close a DB session automatically. Good for MQTT handlers and background tasks."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        with SessionLocal() as db:
            return fn(db, *args, **kwargs)
    return wrapper


def log_event(event_type: str, *, actor_type: str = "system") -> Callable[[Handler], Handler]:
    """Decorator to append an audit event entry after a function runs."""
    def deco(fn: Handler) -> Handler:
        @wraps(fn)
        def wrapper(db, *args, **kwargs):
            result = fn(db, *args, **kwargs)
            payload = {
                "args": _safe_json(args),
                "kwargs": _safe_json(kwargs),
                "result": _safe_json(result),
            }
            db.add(models.Event(
                event_type=event_type,
                actor_type=actor_type,
                payload_json=json.dumps(payload),
            ))
            db.commit()
            return result
        return wrapper
    return deco


def mqtt_topic(topic: str) -> Callable[[MqttHandler], MqttHandler]:
    """Register a function as the handler for an MQTT topic."""
    def deco(fn: MqttHandler) -> MqttHandler:
        MQTT_REGISTRY[topic] = fn
        return fn
    return deco


def dispatch_mqtt(db, topic: str, payload: dict) -> None:
    """Dispatch to topic handler if registered. Always safe (never throws)."""
    handler = MQTT_REGISTRY.get(topic)
    if handler:
        handler(db, payload)


def _safe_json(x: Any) -> Any:
    try:
        json.dumps(x)
        return x
    except Exception:
        return str(x)
