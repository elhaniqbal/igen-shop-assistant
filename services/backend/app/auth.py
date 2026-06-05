from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Cookie, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models

SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "sa_session")
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "12"))
SESSION_SECURE = os.getenv("SESSION_COOKIE_SECURE", "0") == "1"
SESSION_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "lax")


def utcnow() -> datetime:
    return datetime.now()


def _expiry_for_role(role: str) -> datetime:
    if role == "admin":
        return utcnow() + timedelta(hours=12)  # persistent-ish
    return utcnow() + timedelta(minutes=5)    # user timeout


def create_session(db: Session, user: models.User, response: Response) -> dict:
    token = secrets.token_urlsafe(32)
    session_id = models.new_id("sess")
    expires = _expiry_for_role(user.role)
    db.add(models.AuthSession(
        session_id=session_id,
        session_token=token,
        user_id=user.user_id,
        role_snapshot=user.role,
        created_at=utcnow(),
        expires_at=expires,
        revoked_at=None,
    ))
    db.commit()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=SESSION_SECURE,
        samesite=SESSION_SAMESITE,
        max_age=int((expires - utcnow()).total_seconds()),
        path="/",
    )
    return {
    "ok": True,
    "user_id": user.user_id,
    "first_name": user.first_name,
    "last_name": user.last_name,
    "role": user.role,
    "status": user.status,
    "expires_at": expires.isoformat(),
}


def revoke_session(db: Session, token: Optional[str]) -> None:
    if not token:
        return
    row = db.execute(
        select(models.AuthSession).where(models.AuthSession.session_token == token)
    ).scalar_one_or_none()
    if row and row.revoked_at is None:
        row.revoked_at = utcnow()
        db.commit()


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


def get_session_user(db: Session, token: Optional[str]) -> models.User:
    if not token:
        raise HTTPException(status_code=401, detail="auth_required")
    sess = db.execute(
        select(models.AuthSession).where(models.AuthSession.session_token == token)
    ).scalar_one_or_none()
    if not sess or sess.revoked_at is not None or sess.expires_at < utcnow():
        raise HTTPException(status_code=401, detail="invalid_session")
    user = db.get(models.User, sess.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="invalid_session_user")
    if user.status == "banned":
        raise HTTPException(status_code=403, detail="user_banned")
    
    # extend session on use
    sess.expires_at = _expiry_for_role(sess.role_snapshot)
    db.commit()
    return user


def require_admin_user(user: models.User) -> models.User:
    if user.role not in {"admin", "staff"}:
        raise HTTPException(status_code=403, detail="admin_required")
    return user
