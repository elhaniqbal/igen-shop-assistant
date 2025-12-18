from datetime import datetime, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models

def now():
    return datetime.now()

def get_user_by_card(db: Session, card_id: str):
    u = db.execute(select(models.User).where(models.User.card_id == card_id)).scalar_one_or_none()
    if not u:
        raise ValueError("card_not_recognized")
    if u.status != "active":
        raise ValueError("user_not_active")
    return {"user_id": u.user_id, "first_name": u.first_name, "last_name": u.last_name, "role": u.role}

def confirm_tool_receipt(db: Session, user_id: str, tool_tag_id: str):
    tool = db.execute(
        select(models.ToolItem).where(models.ToolItem.tool_tag_id == tool_tag_id)
    ).scalar_one_or_none()
    if not tool:
        raise ValueError("unknown_tool_tag")

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
        select(models.Loan).where(models.Loan.tool_item_id == tool.tool_item_id,
                                  models.Loan.returned_at.is_(None))
    ).scalar_one_or_none()
    if existing:
        raise ValueError("tool_already_loaned")

    due_at = now() + timedelta(hours=req.loan_period_hours or 24)
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
