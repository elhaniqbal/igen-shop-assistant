from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from .deps import get_db, get_mqtt
from .. import schemas
from .. import models
from ..usecases import admin_crud as uc
from ..mqtt import MqttBus
import threading
import uuid

router = APIRouter(prefix="/admin", tags=["admin"])


# ------------ TEST ROUTES ------------

import threading

# just a temporary memory store using multithreading
_MOTOR_TEST_LOCK = threading.Lock()
_MOTOR_TEST: dict[str, dict] = {}

def _set_motor_test_status(request_id: str, patch: dict):
    with _MOTOR_TEST_LOCK:
        cur = _MOTOR_TEST.get(request_id, {"request_id": request_id})
        cur.update(patch)
        _MOTOR_TEST[request_id] = cur

def _get_motor_test_status(request_id: str) -> dict | None:
    with _MOTOR_TEST_LOCK:
        return _MOTOR_TEST.get(request_id)

@router.post("/test/motor", response_model=schemas.AdminMotorTestResp)
def test_motor(body: schemas.AdminMotorTestReq):
    request_id = uuid.uuid4().hex

    _set_motor_test_status(request_id, {
        "request_id": request_id,
        "motor_id": body.motor_id,
        "action": body.action,
        "stage": "queued",
        "error_code": None,
        "error_reason": None,
    })

    mqtt = MqttBus(Depends(get_mqtt))
    if not mqtt:
        _set_motor_test_status(request_id, {"stage": "failed", "error_code": "MQTT_NOT_READY", "error_reason": "mqtt bus not ready"})
        raise HTTPException(status_code=503, detail="MQTT not ready")

    mqtt.publish(schemas.TOPIC_CMD_ADMIN_TEST, {
        "request_id": request_id,
        "motor_id": body.motor_id,
        "action": body.action,
    })

    return schemas.AdminMotorTestResp(request_id=request_id, motor_id=body.motor_id, action=body.action)

@router.get("/test/motor/{request_id}/status", response_model=schemas.AdminMotorTestStatus)
def test_motor_status(request_id: str):
    st = _get_motor_test_status(request_id)
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
    # enforce uniqueness
    existing = db.query(models.User).filter(models.User.card_id == req.card_id).first()
    if existing and existing.user_id != user_id:
        raise HTTPException(409, "card already assigned to another user")

    u.card_id = req.card_id
    db.commit()
    return {"ok": True, "user_id": user_id, "card_id": req.card_id}

@router.put("/tools/items/{tool_item_id}/tag")
def assign_tool_tag(tool_item_id: str, req:schemas.AssignToolTagReq, db: Session = Depends(get_db)):
    ti = db.get(models.ToolItem, tool_item_id)
    if not ti:
        raise HTTPException(404, "tool item not found")

    existing = db.query(models.ToolItem).filter(models.ToolItem.tool_tag_id == req.tool_tag_id).first()
    if existing and existing.tool_item_id != tool_item_id:
        raise HTTPException(409, "tag already assigned to another tool item")

    ti.tool_tag_id = req.tool_tag_id
    db.commit()
    return {"ok": True, "tool_item_id": tool_item_id, "tool_tag_id": req.tool_tag_id}