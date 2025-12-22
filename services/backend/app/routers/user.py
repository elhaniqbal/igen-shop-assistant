from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .deps import get_db, get_mqtt
from ..mqtt import MqttBus
from .. import schemas, models
from ..usecases.user_flow import (
    create_dispense_batch,
    create_return_batch,
    get_batch_status,
    list_active_loans,
)

from ..usecases.rfid_flow import get_user_by_card


router = APIRouter(tags=["user"])



@router.post("/dispense", response_model=schemas.DispenseBatchResponse)
def dispense(req: schemas.DispenseBatchRequest,
             db: Session = Depends(get_db),
             mqtt: MqttBus = Depends(get_mqtt)):
    try:
        out = create_dispense_batch(
            db=db,
            user_id=req.user_id,
            items=[i.model_dump() for i in req.items],
            loan_period_hours=req.loan_period_hours,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Publish commands (async hardware)
    for rid in out["request_ids"]:
        lr = db.get(models.LoanRequest, rid)
        mqtt.publish("igen/cmd/dispense", {
            "request_id": lr.request_id,
            "action": "dispense",
            "user_id": lr.user_id,
            "tool_item_id": lr.tool_item_id,
            "slot_id": lr.slot_id,
            "loan_period_hours": lr.loan_period_hours,
            "ts": lr.created_at.isoformat() + "Z",
        }, qos=1)

    return schemas.DispenseBatchResponse(**out)

@router.get("/dispense/{batch_id}/status")
def dispense_status(batch_id: str, db: Session = Depends(get_db)):
    return {"batch_id": batch_id, "items": get_batch_status(db, batch_id)}

@router.post("/return", response_model=schemas.ReturnBatchResponse)
def do_return(req: schemas.ReturnBatchRequest,
              db: Session = Depends(get_db),
              mqtt: MqttBus = Depends(get_mqtt)):
    try:
        out = create_return_batch(db=db, user_id=req.user_id, items=[i.model_dump() for i in req.items])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    for rid in out["request_ids"]:
        lr = db.get(models.LoanRequest, rid)
        mqtt.publish("igen/cmd/return", {
            "request_id": lr.request_id,
            "action": "return",
            "user_id": lr.user_id,
            "tool_item_id": lr.tool_item_id,
            "slot_id": lr.slot_id,
            "ts": lr.created_at.isoformat() + "Z",
        }, qos=1)

    return schemas.ReturnBatchResponse(**out)

@router.get("/return/{batch_id}/status")
def return_status(batch_id: str, db: Session = Depends(get_db)):
    return {"batch_id": batch_id, "items": get_batch_status(db, batch_id)}

@router.get("/loans")
def loans(user_id: str, db: Session = Depends(get_db)):
    return {"user_id": user_id, "loans": list_active_loans(db, user_id)}

@router.post("/auth/card")
def auth_card(req: schemas.CardAuthRequest, db: Session = Depends(get_db)):
    try:
        return get_user_by_card(db, req.card_id)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))