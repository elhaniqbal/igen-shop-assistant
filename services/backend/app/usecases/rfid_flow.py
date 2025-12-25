from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models


def now():
    return datetime.now()


def get_user_by_card(db: Session, card_id: str):
    u = db.execute(select(models.User).where(models.User.card_id == card_id)).scalar_one_or_none()
    if not u:
        raise ValueError("card_not_recognized")
    if u.status == "banned":
        raise ValueError("user_banned")
    return {"user_id": u.user_id, "first_name": u.first_name, "last_name": u.last_name, "role": u.role}


def confirm_tool_receipt(db: Session, user_id: str, tool_tag_id: str):
    tool = db.execute(
        select(models.ToolItem).where(models.ToolItem.tool_tag_id == tool_tag_id)
    ).scalar_one_or_none()
    if not tool:
        raise ValueError("unknown_tool_tag")

    # Find an existing unconfirmed loan for this user+tool (created on dispense success)
    loan = db.execute(
        select(models.Loan).where(
            models.Loan.user_id == user_id,
            models.Loan.tool_item_id == tool.tool_item_id,
            models.Loan.returned_at.is_(None),
            models.Loan.status == "unconfirmed",
        ).order_by(models.Loan.issued_at.desc())
    ).scalar_one_or_none()

    if loan:
        loan.status = "active"
        loan.confirmed_at = now()
        db.add(models.Event(
            event_type="loan:confirmed",
            actor_type="user",
            actor_id=user_id,
            tool_item_id=tool.tool_item_id,
            payload_json='{"source":"rfid_confirm"}',
        ))
        db.commit()
        return {"loan_id": loan.loan_id}

    # Fallback: if you somehow confirmed without the mqtt handler creating a loan
    req = db.execute(
        select(models.LoanRequest).where(
            models.LoanRequest.user_id == user_id,
            models.LoanRequest.tool_item_id == tool.tool_item_id,
            models.LoanRequest.request_type == "dispense",
            models.LoanRequest.hw_status == "dispensed_ok",
        ).order_by(models.LoanRequest.created_at.desc())
    ).scalar_one_or_none()
    if not req:
        raise ValueError("no_matching_dispense_request")

    existing = db.execute(
        select(models.Loan).where(
            models.Loan.tool_item_id == tool.tool_item_id,
            models.Loan.returned_at.is_(None)
        )
    ).scalar_one_or_none()
    if existing:
        # if it exists but isn't ours, block
        if existing.user_id != user_id:
            raise ValueError("tool_already_loaned")
        # if it exists but our user, just mark active
        existing.status = "active"
        existing.confirmed_at = now()
        db.commit()
        return {"loan_id": existing.loan_id}

    due_at = now()  # will be overwritten below
    hours = req.loan_period_hours or 24
    due_at = now().replace()  # safe copy
    from datetime import timedelta
    due_at = now() + timedelta(hours=hours)

    loan_id = models.new_id("loan")
    db.add(models.Loan(
        loan_id=loan_id,
        user_id=user_id,
        tool_item_id=tool.tool_item_id,
        issued_at=now(),
        due_at=due_at,
        confirmed_at=now(),
        returned_at=None,
        status="active",
    ))

    req.hw_status = "confirmed"
    req.hw_updated_at = now()
    db.commit()
    return {"loan_id": loan_id}
