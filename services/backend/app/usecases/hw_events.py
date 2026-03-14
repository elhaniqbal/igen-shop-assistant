from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models

def now():
    return datetime.now()

def apply_dispense_event(db: Session, payload: dict):
    rid = payload.get("request_id")
    stage = payload.get("stage")
    if not rid or not stage:
        return

    req = db.get(models.LoanRequest, rid)
    if not req:
        return

    if stage == "accepted":
        req.hw_status = "accepted"
    elif stage == "in_progress":
        req.hw_status = "in_progress"
    elif stage == "succeeded":
        req.hw_status = "dispensed_ok"
    elif stage == "failed":
        req.hw_status = "failed"
        req.hw_error_code = payload.get("error_code")
        req.hw_error_reason = payload.get("error_reason")

    req.hw_updated_at = now()
    db.commit()

def apply_return_event(db: Session, payload: dict):
    rid = payload.get("request_id")
    stage = payload.get("stage")
    if not rid or not stage:
        return

    req = db.get(models.LoanRequest, rid)
    if not req:
        return

    if stage == "succeeded":
        req.hw_status = "return_ok"
        req.hw_updated_at = now()
        db.commit()

        loan = db.execute(
            select(models.Loan).where(
                models.Loan.user_id == req.user_id,
                models.Loan.tool_item_id == req.tool_item_id,
                models.Loan.returned_at.is_(None),
            )
        ).scalar_one_or_none()
        if loan:
            loan.returned_at = now()
            loan.status = "returned"
            db.commit()

    elif stage == "failed":
        req.hw_status = "failed"
        req.hw_error_code = payload.get("error_code")
        req.hw_error_reason = payload.get("error_reason")
        req.hw_updated_at = now()
        db.commit()
