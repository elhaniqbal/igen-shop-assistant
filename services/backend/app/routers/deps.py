from __future__ import annotations

from typing import Optional

from fastapi import Cookie, Depends
from sqlalchemy.orm import Session

from ..auth import SESSION_COOKIE_NAME, get_session_user, require_admin_user
from ..db import SessionLocal
from ..mqtt import MqttBus
from .. import models


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_mqtt(req) -> MqttBus:
    return req.app.state.mqtt


def get_current_user(
    db: Session = Depends(get_db),
    session_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> models.User:
    return get_session_user(db, session_token)


def require_admin(
    user: models.User = Depends(get_current_user),
) -> models.User:
    return require_admin_user(user)
