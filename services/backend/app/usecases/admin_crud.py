from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, or_
from sqlalchemy.orm import Session

from .. import models
from ..schemas import (
    AdminUserCreate, AdminUserPatch,
    AdminToolModelCreate, AdminToolModelPatch,
    AdminToolItemCreate, AdminToolItemPatch,
    AdminLoanPatch,
)

def utcnow() -> datetime:
    return datetime.now()

def _conflict(msg: str):
    raise HTTPException(status_code=409, detail=msg)

def _not_found(msg: str):
    raise HTTPException(status_code=404, detail=msg)

def log_event(
    db: Session,
    event_type: str,
    actor_type: str = "system",
    actor_id: Optional[str] = None,
    request_id: Optional[str] = None,
    tool_item_id: Optional[str] = None,
    payload: Optional[dict] = None,
):
    db.add(models.Event(
        ts=utcnow(),
        event_type=event_type,
        actor_type=actor_type,
        actor_id=actor_id,
        request_id=request_id,
        tool_item_id=tool_item_id,
        payload_json=json.dumps(payload or {}),
    ))


# ---------------- USERS ----------------
def list_users(db: Session, search: Optional[str], role: Optional[str], status: Optional[str], limit: int):
    q = select(models.User)
    if search:
        s = f"%{search.strip()}%"
        q = q.where(or_(
            models.User.user_id.like(s),
            models.User.card_id.like(s),
            models.User.student_number.like(s),
            models.User.first_name.like(s),
            models.User.last_name.like(s),
        ))
    if role:
        q = q.where(models.User.role == role)
    if status:
        q = q.where(models.User.status == status)
    q = q.order_by(models.User.last_name.asc(), models.User.first_name.asc()).limit(limit)
    return db.execute(q).scalars().all()

def create_user(db: Session, body: AdminUserCreate):
    if db.get(models.User, body.user_id):
        _conflict("user_id_already_exists")
    if body.card_id:
        ex = db.execute(select(models.User).where(models.User.card_id == body.card_id)).scalar_one_or_none()
        if ex:
            _conflict("card_id_already_in_use")

    u = models.User(**body.model_dump(), created_at=utcnow(), updated_at=utcnow())
    db.add(u)
    log_event(db, "admin_user_created", payload=body.model_dump())
    db.commit()
    db.refresh(u)
    return u

def get_user(db: Session, user_id: str):
    u = db.get(models.User, user_id)
    if not u:
        _not_found("user_not_found")
    return u

def patch_user(db: Session, user_id: str, body: AdminUserPatch):
    u = get_user(db, user_id)
    data = body.model_dump(exclude_unset=True)

    if "card_id" in data and data["card_id"]:
        ex = db.execute(select(models.User).where(models.User.card_id == data["card_id"])).scalar_one_or_none()
        if ex and ex.user_id != user_id:
            _conflict("card_id_already_in_use")

    for k, v in data.items():
        setattr(u, k, v)
    u.updated_at = utcnow()

    log_event(db, "admin_user_updated", payload={"user_id": user_id, "patch": data})
    db.commit()
    db.refresh(u)
    return u

def delete_user(db: Session, user_id: str):
    u = get_user(db, user_id)
    db.delete(u)
    log_event(db, "admin_user_deleted", payload={"user_id": user_id})
    db.commit()
    return {"ok": True}


# ---------------- TOOL MODELS ----------------
def list_tool_models(db: Session, search: Optional[str], category: Optional[str], limit: int):
    q = select(models.ToolModel)
    if search:
        s = f"%{search.strip()}%"
        q = q.where(or_(models.ToolModel.tool_model_id.like(s), models.ToolModel.name.like(s)))
    if category:
        q = q.where(models.ToolModel.category == category)
    q = q.order_by(models.ToolModel.name.asc()).limit(limit)
    return db.execute(q).scalars().all()

def create_tool_model(db: Session, body: AdminToolModelCreate):
    if db.get(models.ToolModel, body.tool_model_id):
        _conflict("tool_model_id_already_exists")
    tm = models.ToolModel(**body.model_dump())
    db.add(tm)
    log_event(db, "admin_tool_model_created", payload=body.model_dump())
    db.commit()
    db.refresh(tm)
    return tm

def get_tool_model(db: Session, tool_model_id: str):
    tm = db.get(models.ToolModel, tool_model_id)
    if not tm:
        _not_found("tool_model_not_found")
    return tm

def patch_tool_model(db: Session, tool_model_id: str, body: AdminToolModelPatch):
    tm = get_tool_model(db, tool_model_id)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(tm, k, v)
    log_event(db, "admin_tool_model_updated", payload={"tool_model_id": tool_model_id, "patch": data})
    db.commit()
    db.refresh(tm)
    return tm

def delete_tool_model(db: Session, tool_model_id: str):
    tm = get_tool_model(db, tool_model_id)
    item = db.execute(select(models.ToolItem).where(models.ToolItem.tool_model_id == tool_model_id).limit(1)).scalar_one_or_none()
    if item:
        _conflict("tool_model_has_tool_items")
    db.delete(tm)
    log_event(db, "admin_tool_model_deleted", payload={"tool_model_id": tool_model_id})
    db.commit()
    return {"ok": True}


# ---------------- TOOL ITEMS ----------------
def list_tool_items(db: Session, tool_model_id: Optional[str], cake_id: Optional[str], is_active: Optional[bool], search: Optional[str], limit: int):
    q = select(models.ToolItem)
    if tool_model_id:
        q = q.where(models.ToolItem.tool_model_id == tool_model_id)
    if cake_id:
        q = q.where(models.ToolItem.cake_id == cake_id)
    if is_active is not None:
        q = q.where(models.ToolItem.is_active == is_active)
    if search:
        s = f"%{search.strip()}%"
        q = q.where(or_(
            models.ToolItem.tool_item_id.like(s),
            models.ToolItem.tool_tag_id.like(s),
            models.ToolItem.slot_id.like(s),
            models.ToolItem.cake_id.like(s),
        ))
    q = q.order_by(models.ToolItem.tool_item_id.asc()).limit(limit)
    return db.execute(q).scalars().all()

def create_tool_item(db: Session, body: AdminToolItemCreate):
    if db.get(models.ToolItem, body.tool_item_id):
        _conflict("tool_item_id_already_exists")
    if not db.get(models.ToolModel, body.tool_model_id):
        raise HTTPException(status_code=400, detail="invalid_tool_model_id")

    ex_tag = db.execute(select(models.ToolItem).where(models.ToolItem.tool_tag_id == body.tool_tag_id)).scalar_one_or_none()
    if ex_tag:
        _conflict("tool_tag_id_already_in_use")

    ti = models.ToolItem(**body.model_dump(), created_at=utcnow(), updated_at=utcnow())
    db.add(ti)
    log_event(db, "admin_tool_item_created", payload=body.model_dump(), tool_item_id=body.tool_item_id)
    db.commit()
    db.refresh(ti)
    return ti

def get_tool_item(db: Session, tool_item_id: str):
    ti = db.get(models.ToolItem, tool_item_id)
    if not ti:
        _not_found("tool_item_not_found")
    return ti

def patch_tool_item(db: Session, tool_item_id: str, body: AdminToolItemPatch):
    ti = get_tool_item(db, tool_item_id)
    data = body.model_dump(exclude_unset=True)

    if "tool_model_id" in data and data["tool_model_id"]:
        if not db.get(models.ToolModel, data["tool_model_id"]):
            raise HTTPException(status_code=400, detail="invalid_tool_model_id")

    if "tool_tag_id" in data and data["tool_tag_id"]:
        ex_tag = db.execute(select(models.ToolItem).where(models.ToolItem.tool_tag_id == data["tool_tag_id"])).scalar_one_or_none()
        if ex_tag and ex_tag.tool_item_id != tool_item_id:
            _conflict("tool_tag_id_already_in_use")

    for k, v in data.items():
        setattr(ti, k, v)
    ti.updated_at = utcnow()

    log_event(db, "admin_tool_item_updated", payload={"tool_item_id": tool_item_id, "patch": data}, tool_item_id=tool_item_id)
    db.commit()
    db.refresh(ti)
    return ti

def delete_tool_item(db: Session, tool_item_id: str):
    ti = get_tool_item(db, tool_item_id)

    active_loan = db.execute(
        select(models.Loan).where(models.Loan.tool_item_id == tool_item_id, models.Loan.returned_at.is_(None)).limit(1)
    ).scalar_one_or_none()
    if active_loan:
        _conflict("tool_item_is_on_active_loan")

    db.delete(ti)
    log_event(db, "admin_tool_item_deleted", payload={"tool_item_id": tool_item_id}, tool_item_id=tool_item_id)
    db.commit()
    return {"ok": True}


# ---------------- LOANS (admin view + force patch) ----------------
def list_loans(db: Session, active_only: bool, overdue_only: bool, user_id: Optional[str], tool_item_id: Optional[str], limit: int):
    q = select(models.Loan)
    if active_only:
        q = q.where(models.Loan.returned_at.is_(None))
    if overdue_only:
        q = q.where(models.Loan.returned_at.is_(None), models.Loan.due_at < utcnow())
    if user_id:
        q = q.where(models.Loan.user_id == user_id)
    if tool_item_id:
        q = q.where(models.Loan.tool_item_id == tool_item_id)
    q = q.order_by(models.Loan.issued_at.desc()).limit(limit)
    return db.execute(q).scalars().all()

def get_loan(db: Session, loan_id: str):
    loan = db.get(models.Loan, loan_id)
    if not loan:
        _not_found("loan_not_found")
    return loan

def patch_loan(db: Session, loan_id: str, body: AdminLoanPatch):
    loan = get_loan(db, loan_id)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(loan, k, v)

    log_event(db, "admin_loan_updated", payload={"loan_id": loan_id, "patch": data}, tool_item_id=loan.tool_item_id)
    db.commit()
    db.refresh(loan)
    return loan


# ---------------- EVENTS (read-only) ----------------
def list_events(db: Session, event_type: Optional[str], actor_id: Optional[str], request_id: Optional[str], tool_item_id: Optional[str], limit: int):
    q = select(models.Event)
    if event_type:
        q = q.where(models.Event.event_type == event_type)
    if actor_id:
        q = q.where(models.Event.actor_id == actor_id)
    if request_id:
        q = q.where(models.Event.request_id == request_id)
    if tool_item_id:
        q = q.where(models.Event.tool_item_id == tool_item_id)
    q = q.order_by(models.Event.ts.desc()).limit(limit)
    return db.execute(q).scalars().all()

def get_event(db: Session, event_id: int):
    e = db.get(models.Event, event_id)
    if not e:
        _not_found("event_not_found")
    return e
