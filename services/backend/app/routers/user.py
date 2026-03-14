from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
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
def dispense(
    req: schemas.DispenseBatchRequest,
    db: Session = Depends(get_db),
    mqtt: MqttBus = Depends(get_mqtt),
):
    try:
        out = create_dispense_batch(
            db=db,
            user_id=req.user_id,
            items=[i.model_dump() for i in req.items],  # [{tool_model_id, qty}]
            loan_period_hours=req.loan_period_hours,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Publish commands (async hardware)
    for rid in out["request_ids"]:
        lr = db.get(models.LoanRequest, rid)
        if not lr:
            continue

        mqtt.publish(
            "igen/cmd/dispense",
            {
                "request_id": lr.request_id,
                "action": "dispense",
                "user_id": lr.user_id,
                "tool_item_id": lr.tool_item_id,
                "slot_id": lr.slot_id,
                "loan_period_hours": lr.loan_period_hours,
                "ts": lr.created_at.isoformat() + "Z",
            },
            qos=1,
        )

    return schemas.DispenseBatchResponse(**out)


@router.get("/dispense/{batch_id}/status")
def dispense_status(batch_id: str, db: Session = Depends(get_db)):
    return {"batch_id": batch_id, "items": get_batch_status(db, batch_id)}


@router.post("/return", response_model=schemas.ReturnBatchResponse)
def do_return(
    req: schemas.ReturnBatchRequest,
    db: Session = Depends(get_db),
    mqtt: MqttBus = Depends(get_mqtt),
):
    try:
        out = create_return_batch(
            db=db,
            user_id=req.user_id,
            items=[i.model_dump() for i in req.items],  # [{tool_item_id}]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    for rid in out["request_ids"]:
        lr = db.get(models.LoanRequest, rid)
        if not lr:
            continue

        mqtt.publish(
            "igen/cmd/return",
            {
                "request_id": lr.request_id,
                "action": "return",
                "user_id": lr.user_id,
                "tool_item_id": lr.tool_item_id,
                "slot_id": lr.slot_id,
                "ts": lr.created_at.isoformat() + "Z",
            },
            qos=1,
        )

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
        print("RECEIVED CARD ID: ", req.card_id)
        return get_user_by_card(db, req.card_id)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/catalog")
def catalog(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
):
    """
    User-facing browse catalog: tool models + availability counts.
    No admin auth needed.
    """
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
       AND l.status IN ('active','overdue')
      WHERE (:search IS NULL OR lower(tm.name) LIKE '%' || lower(:search) || '%')
        AND (:category IS NULL OR tm.category = :category)
      GROUP BY tm.tool_model_id, tm.name, tm.category, tm.description
      ORDER BY tm.name ASC
      LIMIT :limit
    """)
    rows = db.execute(q, {"search": search, "category": category, "limit": limit}).mappings().all()
    return [dict(r) for r in rows]
