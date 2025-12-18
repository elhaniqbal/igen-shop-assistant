from __future__ import annotations
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models

def now() -> datetime:
    return datetime.now()
def must_user_active(db: Session, user_id: str) -> models.User:
    u = db.get(models.User, user_id)
    if not u or u.status != "active":
        raise ValueError("invalid_user")
    return u

def create_dispense_batch(db: Session, user_id: str, items: list[dict], loan_period_hours: int):
    must_user_active(db, user_id)

    batch_id = models.new_id("batch")  # or your own helper
    request_ids: list[str] = []
    idx = 0

    for item in items:
        tool_item_id = item["tool_item_id"]
        slot_id = item["slot_id"]
        qty = int(item.get("qty", 1))

        tool = db.get(models.ToolItem, tool_item_id)
        if not tool or not tool.is_active:
            raise ValueError("invalid_tool_item")

        active = db.execute(
            select(models.Loan).where(models.Loan.tool_item_id == tool_item_id,
                                      models.Loan.returned_at.is_(None))
        ).scalar_one_or_none()
        if active:
            raise ValueError("tool_already_loaned")

        for _ in range(qty):
            idx += 1
            rid = f"{batch_id}_item_{idx}"
            request_ids.append(rid)

            db.add(models.LoanRequest(
                request_id=rid,
                batch_id=batch_id,
                request_type="dispense",
                user_id=user_id,
                tool_item_id=tool_item_id,
                slot_id=slot_id,
                loan_period_hours=loan_period_hours,
                hw_status="pending",
                created_at=now(),
            ))

    db.commit()
    return {"batch_id": batch_id, "request_ids": request_ids}

def create_return_batch(db: Session, user_id: str, items: list[dict]):
    must_user_active(db, user_id)

    batch_id = models.new_id("retbatch")
    request_ids: list[str] = []
    idx = 0

    for item in items:
        loan_id = item["loan_id"]
        tool_item_id = item["tool_item_id"]
        slot_id = item["slot_id"]

        loan = db.get(models.Loan, loan_id)
        if not loan or loan.user_id != user_id or loan.returned_at is not None:
            raise ValueError("invalid_loan")

        idx += 1
        rid = f"{batch_id}_item_{idx}"
        request_ids.append(rid)

        db.add(models.LoanRequest(
            request_id=rid,
            batch_id=batch_id,
            request_type="return",
            user_id=user_id,
            tool_item_id=tool_item_id,
            slot_id=slot_id,
            hw_status="pending",
            created_at=now(),
        ))

    db.commit()
    return {"batch_id": batch_id, "request_ids": request_ids}

def get_batch_status(db: Session, batch_id: str):
    rows = db.execute(
        select(models.LoanRequest).where(models.LoanRequest.batch_id == batch_id)
    ).scalars().all()

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
        select(models.Loan).where(models.Loan.user_id == user_id,
                                  models.Loan.returned_at.is_(None))
    ).scalars().all()

    return [{
        "loan_id": r.loan_id,
        "tool_item_id": r.tool_item_id,
        "issued_at": r.issued_at.isoformat(),
        "due_at": r.due_at.isoformat(),
        "status": r.status,
    } for r in rows]
