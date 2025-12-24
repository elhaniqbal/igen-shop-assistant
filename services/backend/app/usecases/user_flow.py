from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from .. import models


def now() -> datetime:
    return datetime.now()


def _new_id(prefix: str) -> str:
    # don’t rely on models.new_id (but it exists now anyway)
    return f"{prefix}_{uuid.uuid4().hex}"


def must_user_can_transact(db: Session, user_id: str) -> models.User:
    u = db.get(models.User, user_id)
    if not u:
        raise ValueError("invalid_user")

    # Your DB uses default status="good" for everyone (including admins)
    # so "active only" blocks real users.
    if u.status in ("banned", "delinquent"):
        raise ValueError("invalid_user")

    return u


ACTIVE_LOAN_STATUSES = ("active", "overdue")
RESERVED_HW_STATUSES = ("pending", "accepted", "in_progress", "dispensed_ok")  # include dispensed_ok to avoid double-alloc before confirm


def _is_tool_item_available(db: Session, tool_item_id: str) -> bool:
    active = db.execute(
        select(models.Loan).where(
            models.Loan.tool_item_id == tool_item_id,
            models.Loan.returned_at.is_(None),
            models.Loan.status.in_(ACTIVE_LOAN_STATUSES),
        )
    ).scalar_one_or_none()
    if active:
        return False

    reserved = db.execute(
        select(models.LoanRequest).where(
            models.LoanRequest.tool_item_id == tool_item_id,
            models.LoanRequest.request_type == "dispense",
            models.LoanRequest.hw_status.in_(RESERVED_HW_STATUSES),
        )
    ).scalar_one_or_none()
    if reserved:
        return False

    return True


def _allocate_tool_item_for_model(db: Session, tool_model_id: str) -> models.ToolItem | None:
    candidates = db.execute(
        select(models.ToolItem).where(
            models.ToolItem.tool_model_id == tool_model_id,
            models.ToolItem.is_active.is_(True),
        )
    ).scalars().all()

    for ti in candidates:
        if _is_tool_item_available(db, ti.tool_item_id):
            return ti
    return None


def _enforce_tool_model_policy(db: Session, user_id: str, tool_model_id: str, requested_hours: int, requested_qty: int) -> None:
    tm = db.get(models.ToolModel, tool_model_id)
    if not tm:
        raise ValueError("invalid_tool_model_id")

    # max loan hours
    if tm.max_loan_hours is not None and requested_hours > int(tm.max_loan_hours):
        raise ValueError(f"loan_period_exceeds_policy:{tool_model_id}:{tm.max_loan_hours}")

    # max qty per user (active loans + reserved dispenses + current request)
    if tm.max_qty_per_user is not None:
        active_count = db.execute(
            select(func.count()).select_from(models.Loan)
            .join(models.ToolItem, models.ToolItem.tool_item_id == models.Loan.tool_item_id)
            .where(
                models.Loan.user_id == user_id,
                models.Loan.returned_at.is_(None),
                models.Loan.status.in_(ACTIVE_LOAN_STATUSES),
                models.ToolItem.tool_model_id == tool_model_id,
            )
        ).scalar_one()

        reserved_count = db.execute(
            select(func.count()).select_from(models.LoanRequest)
            .join(models.ToolItem, models.ToolItem.tool_item_id == models.LoanRequest.tool_item_id)
            .where(
                models.LoanRequest.user_id == user_id,
                models.LoanRequest.request_type == "dispense",
                models.LoanRequest.hw_status.in_(("pending", "accepted", "in_progress", "dispensed_ok")),
                models.ToolItem.tool_model_id == tool_model_id,
            )
        ).scalar_one()

        if int(active_count) + int(reserved_count) + int(requested_qty) > int(tm.max_qty_per_user):
            raise ValueError(f"qty_exceeds_policy:{tool_model_id}:{tm.max_qty_per_user}")


def create_dispense_batch(db: Session, user_id: str, items: list[dict], loan_period_hours: int):
    """
    items: [{ tool_model_id: str, qty: int }]
    Server allocates tool_item_id + slot_id.
    """
    must_user_can_transact(db, user_id)

    if not items:
        raise ValueError("no_items")

    batch_id = _new_id("batch")
    request_ids: list[str] = []
    idx = 0

    for item in items:
        tool_model_id = item.get("tool_model_id")
        qty = int(item.get("qty", 1))

        if not tool_model_id:
            raise ValueError("missing_tool_model_id")
        if qty < 1:
            raise ValueError("invalid_qty")

        _enforce_tool_model_policy(db, user_id, tool_model_id, loan_period_hours, qty)

        for _ in range(qty):
            ti = _allocate_tool_item_for_model(db, tool_model_id)
            if not ti:
                raise ValueError(f"not_enough_available_items:{tool_model_id}")

            idx += 1
            rid = f"{batch_id}_item_{idx}"
            request_ids.append(rid)

            db.add(
                models.LoanRequest(
                    request_id=rid,
                    batch_id=batch_id,
                    request_type="dispense",
                    user_id=user_id,
                    tool_item_id=ti.tool_item_id,
                    slot_id=ti.slot_id,
                    loan_period_hours=loan_period_hours,
                    hw_status="pending",
                    created_at=now(),
                )
            )

    db.commit()
    return {"batch_id": batch_id, "request_ids": request_ids}


def create_return_batch(db: Session, user_id: str, items: list[dict]):
    """
    items: [{ tool_item_id: str }]
    """
    must_user_can_transact(db, user_id)

    if not items:
        raise ValueError("no_items")

    batch_id = _new_id("retbatch")
    request_ids: list[str] = []
    idx = 0

    for item in items:
        tool_item_id = item.get("tool_item_id")
        if not tool_item_id:
            raise ValueError("missing_tool_item_id")

        loan = db.execute(
            select(models.Loan).where(
                models.Loan.user_id == user_id,
                models.Loan.tool_item_id == tool_item_id,
                models.Loan.returned_at.is_(None),
                models.Loan.status.in_(ACTIVE_LOAN_STATUSES),
            )
        ).scalar_one_or_none()
        if not loan:
            raise ValueError("invalid_loan")

        tool = db.get(models.ToolItem, tool_item_id)
        if not tool:
            raise ValueError("invalid_tool_item")

        idx += 1
        rid = f"{batch_id}_item_{idx}"
        request_ids.append(rid)

        db.add(
            models.LoanRequest(
                request_id=rid,
                batch_id=batch_id,
                request_type="return",
                user_id=user_id,
                tool_item_id=tool_item_id,
                slot_id=tool.slot_id,
                hw_status="pending",
                created_at=now(),
            )
        )

    db.commit()
    return {"batch_id": batch_id, "request_ids": request_ids}


def get_batch_status(db: Session, batch_id: str):
    rows = db.execute(select(models.LoanRequest).where(models.LoanRequest.batch_id == batch_id)).scalars().all()
    return [{
        "request_id": r.request_id,
        "request_type": r.request_type,
        "tool_item_id": r.tool_item_id,
        "slot_id": r.slot_id,
        "hw_status": r.hw_status,
        "hw_error_code": r.hw_error_code,
        "hw_error_reason": r.hw_error_reason,
        "created_at": r.created_at.isoformat(),
        "hw_updated_at": r.hw_updated_at.isoformat() if r.hw_updated_at else None,
    } for r in rows]


def list_active_loans(db: Session, user_id: str):
    rows = db.execute(
        select(models.Loan).where(
            models.Loan.user_id == user_id,
            models.Loan.returned_at.is_(None),
            models.Loan.status.in_(ACTIVE_LOAN_STATUSES),
        )
    ).scalars().all()

    return [{
        "loan_id": r.loan_id,
        "tool_item_id": r.tool_item_id,
        "issued_at": r.issued_at.isoformat(),
        "due_at": r.due_at.isoformat(),
        "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None,
        "returned_at": r.returned_at.isoformat() if r.returned_at else None,
        "status": r.status,
    } for r in rows]
