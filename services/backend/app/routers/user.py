from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from .deps import get_db, get_mqtt
from ..mqtt import MqttBus
from .. import schemas, models
from ..usecases.user_flow import (
    build_hw_payload,
    create_dispense_batch,
    create_return_batch,
    get_batch_status,
    list_active_loans,
)
from ..usecases.rfid_flow import get_user_by_card

router = APIRouter(tags=["user"])


def _publish_first_request_for_batch(db: Session, mqtt: MqttBus, batch_id: str):
    lr = (
        db.query(models.LoanRequest)
        .filter(models.LoanRequest.batch_id == batch_id)
        .order_by(models.LoanRequest.created_at.asc(), models.LoanRequest.request_id.asc())
        .first()
    )
    if not lr:
        return

    payload = build_hw_payload(db, lr.request_id)
    topic = "igen/cmd/dispense" if lr.request_type == "dispense" else "igen/cmd/return"
    mqtt.publish(topic, payload, qos=1)


@router.post("/dispense", response_model=schemas.DispenseBatchResponse)
def dispense(req: schemas.DispenseBatchRequest, db: Session = Depends(get_db), mqtt: MqttBus = Depends(get_mqtt)):
    try:
        out = create_dispense_batch(
            db=db,
            user_id=req.user_id,
            items=[i.model_dump() for i in req.items],
            loan_period_hours=req.loan_period_hours,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _publish_first_request_for_batch(db, mqtt, out["batch_id"])
    return schemas.DispenseBatchResponse(**out)


@router.get("/dispense/{batch_id}/status")
def dispense_status(batch_id: str, db: Session = Depends(get_db)):
    return {"batch_id": batch_id, "items": get_batch_status(db, batch_id)}


@router.post("/return", response_model=schemas.ReturnBatchResponse)
def do_return(req: schemas.ReturnBatchRequest, db: Session = Depends(get_db), mqtt: MqttBus = Depends(get_mqtt)):
    try:
        out = create_return_batch(db=db, user_id=req.user_id, items=[i.model_dump() for i in req.items])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _publish_first_request_for_batch(db, mqtt, out["batch_id"])
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


@router.get("/catalog")
def catalog(db: Session = Depends(get_db), search: str | None = Query(default=None), category: str | None = Query(default=None), limit: int = Query(default=500, ge=1, le=2000)):
    q = text("""
      SELECT
        tm.tool_model_id AS tool_model_id,
        tm.name AS name,
        tm.category AS category,
        tm.description AS description,
        COUNT(ti.tool_item_id) AS total,
        SUM(CASE WHEN l.loan_id IS NULL THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN l.loan_id IS NOT NULL THEN 1 ELSE 0 END) AS checked_out
      FROM tool_models tm
      LEFT JOIN tool_items ti
        ON ti.tool_model_id = tm.tool_model_id
       AND ti.is_active = 1
      LEFT JOIN loans l
        ON l.tool_item_id = ti.tool_item_id
       AND l.returned_at IS NULL
       AND l.status IN ('active','overdue','unconfirmed')
      WHERE (:search IS NULL OR lower(tm.name) LIKE '%' || lower(:search) || '%')
        AND (:category IS NULL OR tm.category = :category)
      GROUP BY tm.tool_model_id, tm.name, tm.category, tm.description
      ORDER BY tm.name ASC
      LIMIT :limit
    """)
    rows = db.execute(q, {"search": search, "category": category, "limit": limit}).mappings().all()
    return [dict(r) for r in rows]
