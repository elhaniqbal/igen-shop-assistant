from fastapi import APIRouter, Depends, Query, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session
from .deps import get_db, get_mqtt
from .. import schemas
from .. import models
from ..usecases import admin_crud as uc
from ..mqtt import MqttBus
import uuid
from datetime import timedelta

from ..motor_test_store import set_motor_test_status, get_motor_test_status

router = APIRouter(prefix="/admin", tags=["admin"])


# ------------ TEST ROUTES ------------

@router.post("/test/motor", response_model=schemas.AdminMotorTestResp)
def test_motor(body: schemas.AdminMotorTestReq, request: Request):
    request_id = uuid.uuid4().hex

    set_motor_test_status(
        request_id,
        {
            "request_id": request_id,
            "motor_id": body.motor_id,
            "action": body.action,
            "stage": "queued",
            "error_code": None,
            "error_reason": None,
        },
    )

    mqtt = request.app.state.mqtt
    if not mqtt:
        set_motor_test_status(
            request_id,
            {"stage": "failed", "error_code": "MQTT_NOT_READY", "error_reason": "mqtt bus not ready"},
        )
        raise HTTPException(status_code=503, detail="MQTT not ready")

    mqtt.publish(
        "igen/cmd/admin_test/motor",
        {
            "request_id": request_id,
            "motor_id": body.motor_id,
            "action": body.action,
        },
    )

    return schemas.AdminMotorTestResp(request_id=request_id, motor_id=body.motor_id, action=body.action)


@router.get("/test/motor/{request_id}/status", response_model=schemas.AdminMotorTestStatus)
def test_motor_status(request_id: str):
    st = get_motor_test_status(request_id)
    if not st:
        raise HTTPException(status_code=404, detail="unknown request_id")
    return st


# ---------------- USERS ----------------
@router.get("/users", response_model=list[schemas.UserOut])
def list_users(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    role: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
):
    return uc.list_users(db, search, role, status, limit)


@router.post("/users", response_model=schemas.UserOut)
def create_user(body: schemas.AdminUserCreate, db: Session = Depends(get_db)):
    return uc.create_user(db, body)


@router.get("/users/{user_id}", response_model=schemas.UserOut)
def get_user(user_id: str, db: Session = Depends(get_db)):
    return uc.get_user(db, user_id)


@router.patch("/users/{user_id}", response_model=schemas.UserOut)
def patch_user(user_id: str, body: schemas.AdminUserPatch, db: Session = Depends(get_db)):
    return uc.patch_user(db, user_id, body)


@router.delete("/users/{user_id}")
def delete_user(user_id: str, db: Session = Depends(get_db)):
    return uc.delete_user(db, user_id)


# ---------------- TOOL MODELS ----------------
@router.get("/tool-models", response_model=list[schemas.ToolModelOut])
def list_tool_models(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
):
    return uc.list_tool_models(db, search, category, limit)


@router.post("/tool-models", response_model=schemas.ToolModelOut)
def create_tool_model(body: schemas.AdminToolModelCreate, db: Session = Depends(get_db)):
    return uc.create_tool_model(db, body)


@router.get("/tool-models/{tool_model_id}", response_model=schemas.ToolModelOut)
def get_tool_model(tool_model_id: str, db: Session = Depends(get_db)):
    return uc.get_tool_model(db, tool_model_id)


@router.patch("/tool-models/{tool_model_id}", response_model=schemas.ToolModelOut)
def patch_tool_model(tool_model_id: str, body: schemas.AdminToolModelPatch, db: Session = Depends(get_db)):
    return uc.patch_tool_model(db, tool_model_id, body)


@router.delete("/tool-models/{tool_model_id}")
def delete_tool_model(tool_model_id: str, db: Session = Depends(get_db)):
    return uc.delete_tool_model(db, tool_model_id)


# ---------------- TOOL ITEMS ----------------
@router.get("/tool-items", response_model=list[schemas.ToolItemOut])
def list_tool_items(
    db: Session = Depends(get_db),
    tool_model_id: str | None = Query(default=None),
    cake_id: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
):
    return uc.list_tool_items(db, tool_model_id, cake_id, is_active, search, limit)


@router.post("/tool-items", response_model=schemas.ToolItemOut)
def create_tool_item(body: schemas.AdminToolItemCreate, db: Session = Depends(get_db)):
    return uc.create_tool_item(db, body)


@router.get("/tool-items/{tool_item_id}", response_model=schemas.ToolItemOut)
def get_tool_item(tool_item_id: str, db: Session = Depends(get_db)):
    return uc.get_tool_item(db, tool_item_id)


@router.patch("/tool-items/{tool_item_id}", response_model=schemas.ToolItemOut)
def patch_tool_item(tool_item_id: str, body: schemas.AdminToolItemPatch, db: Session = Depends(get_db)):
    return uc.patch_tool_item(db, tool_item_id, body)


@router.delete("/tool-items/{tool_item_id}")
def delete_tool_item(tool_item_id: str, db: Session = Depends(get_db)):
    return uc.delete_tool_item(db, tool_item_id)


# ---------------- LOANS (admin) ----------------
@router.get("/loans", response_model=list[schemas.LoanOut])
def list_loans(
    db: Session = Depends(get_db),
    active_only: bool = Query(default=False),
    overdue_only: bool = Query(default=False),
    user_id: str | None = Query(default=None),
    tool_item_id: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=5000),
):
    return uc.list_loans(db, active_only, overdue_only, user_id, tool_item_id, limit)


@router.get("/loans/{loan_id}", response_model=schemas.LoanOut)
def get_loan(loan_id: str, db: Session = Depends(get_db)):
    return uc.get_loan(db, loan_id)


@router.patch("/loans/{loan_id}", response_model=schemas.LoanOut)
def patch_loan(loan_id: str, body: schemas.AdminLoanPatch, db: Session = Depends(get_db)):
    return uc.patch_loan(db, loan_id, body)


@router.post("/loans/{loan_id}/extend")
def extend_loan(loan_id: str, req: schemas.AdminExtendLoanReq, db: Session = Depends(get_db)):
    loan = db.get(models.Loan, loan_id)
    if not loan:
        raise HTTPException(404, "loan not found")
    if loan.returned_at is not None:
        raise HTTPException(400, "loan already returned")

    base = loan.due_at if getattr(loan, "due_at", None) else models.utcnow()
    loan.due_at = base + timedelta(hours=req.add_hours)

    if loan.status == "overdue":
        loan.status = "active"

    db.commit()
    return {"ok": True, "loan_id": loan_id, "due_at": loan.due_at.isoformat() + "Z"}


# ---------------- EVENTS (read-only) ----------------
@router.get("/events", response_model=list[schemas.EventOut])
def list_events(
    db: Session = Depends(get_db),
    event_type: str | None = Query(default=None),
    actor_id: str | None = Query(default=None),
    request_id: str | None = Query(default=None),
    tool_item_id: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=5000),
):
    return uc.list_events(db, event_type, actor_id, request_id, tool_item_id, limit)


@router.get("/events/{event_id}", response_model=schemas.EventOut)
def get_event(event_id: int, db: Session = Depends(get_db)):
    return uc.get_event(db, event_id)


@router.put("/users/{user_id}/card")
def assign_user_card(user_id: str, req: schemas.AssignCardReq, db: Session = Depends(get_db)):
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(404, "user not found")
    existing = db.query(models.User).filter(models.User.card_id == req.card_id).first()
    if existing and existing.user_id != user_id:
        raise HTTPException(409, "card already assigned to another user")

    u.card_id = req.card_id
    db.commit()
    return {"ok": True, "user_id": user_id, "card_id": req.card_id}


@router.put("/tools/items/{tool_item_id}/tag")
def assign_tool_tag(tool_item_id: str, req: schemas.AssignToolTagReq, db: Session = Depends(get_db)):
    ti = db.get(models.ToolItem, tool_item_id)
    if not ti:
        raise HTTPException(404, "tool item not found")

    existing = db.query(models.ToolItem).filter(models.ToolItem.tool_tag_id == req.tool_tag_id).first()
    if existing and existing.tool_item_id != tool_item_id:
        raise HTTPException(409, "tag already assigned to another tool item")

    ti.tool_tag_id = req.tool_tag_id
    db.commit()
    return {"ok": True, "tool_item_id": tool_item_id, "tool_tag_id": req.tool_tag_id}


@router.get("/inventory")
def inventory(db: Session = Depends(get_db)):
    q = text("""
      SELECT
        tm.tool_model_id AS tool_model_id,
        tm.name AS name,
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
      GROUP BY tm.tool_model_id, tm.name
      ORDER BY tm.name ASC
    """)
    rows = db.execute(q).mappings().all()
    return [dict(r) for r in rows]


@router.get("/metrics/usage")
def metrics_usage(db: Session = Depends(get_db), days: int = Query(default=14, ge=1, le=365)):
    q = text("""
    WITH recent AS (
      SELECT
        date(ts) AS day,
        event_type,
        payload_json
      FROM events
      WHERE ts >= datetime('now', '-' || :days || ' days')
        AND (event_type = 'mqtt:igen/evt/dispense' OR event_type = 'mqtt:igen/evt/return')
    ),
    disp AS (
      SELECT day, count(*) AS c
      FROM recent
      WHERE event_type = 'mqtt:igen/evt/dispense'
        AND json_extract(payload_json, '$.stage') = 'succeeded'
      GROUP BY day
    ),
    ret AS (
      SELECT day, count(*) AS c
      FROM recent
      WHERE event_type = 'mqtt:igen/evt/return'
        AND json_extract(payload_json, '$.stage') = 'succeeded'
      GROUP BY day
    )
    SELECT
      d.day AS day,
      COALESCE(d.c, 0) AS dispenses,
      COALESCE(r.c, 0) AS returns
    FROM (SELECT day FROM disp UNION SELECT day FROM ret) dayset
    LEFT JOIN disp d ON d.day = dayset.day
    LEFT JOIN ret r ON r.day = dayset.day
    ORDER BY day ASC;
    """)
    rows = db.execute(q, {"days": days}).mappings().all()
    return [{"day": r["day"], "dispenses": r["dispenses"], "returns": r["returns"]} for r in rows]
