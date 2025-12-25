from __future__ import annotations

from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models


def now() -> datetime:
    return datetime.now()


# treat "good" and "active" as allowed. block banned.
ALLOWED_USER_STATUSES = ("good", "active", "delinquent")


def must_user_active(db: Session, user_id: str) -> models.User:
    u = db.get(models.User, user_id)
    if not u:
        raise ValueError("invalid_user")
    if u.status == "banned":
        raise ValueError("user_banned")
    if u.status not in ALLOWED_USER_STATUSES:
        raise ValueError("invalid_user")
    return u


ACTIVE_LOAN_STATUSES = ("active", "overdue", "unconfirmed")  # unconfirmed still removes stock
RESERVED_HW_STATUSES = ("pending", "accepted", "in_progress")


def _is_tool_item_available(db: Session, tool_item_id: str) -> bool:
    # not already on an open loan (including unconfirmed)
    active = db.execute(
        select(models.Loan).where(
            models.Loan.tool_item_id == tool_item_id,
            models.Loan.returned_at.is_(None),
            models.Loan.status.in_(ACTIVE_LOAN_STATUSES),
        )
    ).scalar_one_or_none()
    if active:
        return False

    # not reserved by an in-flight dispense request
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


def create_dispense_batch(db: Session, user_id: str, items: list[dict], loan_period_hours: int):
    must_user_active(db, user_id)

    if not items:
        raise ValueError("no_items")

    batch_id = models.new_id("batch")
    request_ids: list[str] = []
    idx = 0

    for item in items:
        tool_model_id = item.get("tool_model_id")
        qty = int(item.get("qty", 1))

        if not tool_model_id:
            raise ValueError("missing_tool_model_id")
        if qty < 1:
            raise ValueError("invalid_qty")

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
    must_user_active(db, user_id)

    batch_id = models.new_id("retbatch")
    request_ids: list[str] = []
    idx = 0

    if not items:
        raise ValueError("no_items")

    for item in items:
        tool_item_id = item.get("tool_item_id")
        if not tool_item_id:
            raise ValueError("missing_tool_item_id")

        loan = db.execute(
            select(models.Loan).where(
                models.Loan.user_id == user_id,
                models.Loan.tool_item_id == tool_item_id,
                models.Loan.returned_at.is_(None),
                models.Loan.status.in_(("active", "overdue", "unconfirmed")),
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
    rows = db.execute(
        select(models.LoanRequest).where(models.LoanRequest.batch_id == batch_id)
    ).scalars().all()

    return [
        {
            "request_id": r.request_id,
            "request_type": r.request_type,
            "tool_item_id": r.tool_item_id,
            "slot_id": r.slot_id,
            "hw_status": r.hw_status,
            "hw_error_code": r.hw_error_code,
            "hw_error_reason": r.hw_error_reason,
            "created_at": r.created_at.isoformat(),
            "hw_updated_at": r.hw_updated_at.isoformat() if r.hw_updated_at else None,
        }
        for r in rows
    ]


def list_active_loans(db: Session, user_id: str):
    # Join loans -> tool_items -> tool_models so UI can show real names
    rows = db.execute(
        select(
            models.Loan,
            models.ToolItem.tool_model_id,
            models.ToolItem.tool_tag_id,
            models.ToolModel.name,
            models.ToolModel.category,
        )
        .join(models.ToolItem, models.ToolItem.tool_item_id == models.Loan.tool_item_id)
        .join(models.ToolModel, models.ToolModel.tool_model_id == models.ToolItem.tool_model_id)
        .where(
            models.Loan.user_id == user_id,
            models.Loan.returned_at.is_(None),
            models.Loan.status.in_(("active", "overdue", "unconfirmed")),
        )
        .order_by(models.Loan.issued_at.desc())
    ).all()

    out = []
    for loan, tool_model_id, tool_tag_id, tool_name, tool_category in rows:
        out.append(
            {
                "loan_id": loan.loan_id,
                "tool_item_id": loan.tool_item_id,
                "tool_model_id": tool_model_id,
                "tool_name": tool_name,
                "tool_category": tool_category,
                "tool_tag_id": tool_tag_id,  # used for return validation; NEVER display
                "issued_at": loan.issued_at.isoformat(),
                "due_at": loan.due_at.isoformat(),
                "confirmed_at": loan.confirmed_at.isoformat() if loan.confirmed_at else None,
                "returned_at": loan.returned_at.isoformat() if loan.returned_at else None,
                "status": loan.status,
            }
        )
    return out