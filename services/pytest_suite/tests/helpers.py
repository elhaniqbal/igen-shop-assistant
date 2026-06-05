
from datetime import timedelta


def create_open_loan(db, models, *, loan_id, user_id, tool_item_id, status="active"):
    loan = models.Loan(
        loan_id=loan_id,
        user_id=user_id,
        tool_item_id=tool_item_id,
        issued_at=models.utcnow(),
        due_at=models.utcnow() + timedelta(hours=24),
        confirmed_at=models.utcnow() if status != "unconfirmed" else None,
        returned_at=None,
        status=status,
    )
    db.add(loan)
    db.commit()
    return loan


def create_loan_request(db, models, *, request_id, batch_id, request_type, user_id, tool_item_id, slot_id, hw_status="pending"):
    req = models.LoanRequest(
        request_id=request_id,
        batch_id=batch_id,
        request_type=request_type,
        user_id=user_id,
        tool_item_id=tool_item_id,
        slot_id=slot_id,
        hw_status=hw_status,
        loan_period_hours=24 if request_type == "dispense" else None,
    )
    db.add(req)
    db.commit()
    return req
