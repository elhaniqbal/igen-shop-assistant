from fastapi import APIRouter, Depends, Query, HTTPException, Request, Body
from sqlalchemy import text, select
from sqlalchemy.orm import Session
from .deps import get_db, get_mqtt, require_admin
from .. import schemas
from .. import models
from ..usecases import admin_crud as uc
from ..usecases.user_flow import get_cake_overview, get_cake_current_slot, set_cake_current_slot, normalize_slot
from ..mqtt import MqttBus
import uuid
from datetime import timedelta, datetime
import json
import os
import shutil
from pathlib import Path
from urllib import error as urlerror, request as urlrequest

from ..motor_test_store import set_motor_test_status, get_motor_test_status
from ..cake_cmd_store import set_cake_cmd_status, get_cake_cmd_status
from ..services.email_service import send_email, send_template, list_templates


router = APIRouter(prefix="/admin", tags=["admin"])

MOONRAKER_URL = os.getenv("MOONRAKER_URL", "http://host.docker.internal:7125").rstrip("/")


KLIPPER_CONFIG_DIR = Path(os.getenv("KLIPPER_CONFIG_DIR", "/klipper-config"))
KLIPPER_VARS_FILE = Path(os.getenv("KLIPPER_VARS_FILE", str(KLIPPER_CONFIG_DIR / "vars.cfg")))
KLIPPER_STEPPERS_FILE = Path(os.getenv("KLIPPER_STEPPERS_FILE", str(KLIPPER_CONFIG_DIR / "steppers.cfg")))
KLIPPER_MACROS_FILE = Path(os.getenv("KLIPPER_MACROS_FILE", str(KLIPPER_CONFIG_DIR / "macros.cfg")))

ALLOWED_KLIPPER_FILES = {
    "vars.cfg": KLIPPER_VARS_FILE,
    "steppers.cfg": KLIPPER_STEPPERS_FILE,
    "macros.cfg": KLIPPER_MACROS_FILE,
}


def _mqtt_or_503(request: Request):
    mqtt = getattr(request.app.state, "mqtt", None)
    if not mqtt:
        raise HTTPException(status_code=503, detail="MQTT not ready")
    return mqtt


def _new_request_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _publish_admin_command(
    request: Request,
    *,
    topic: str,
    payload: dict,
    event_type: str,
    db: Session | None = None,
):
    mqtt = _mqtt_or_503(request)
    if db is not None:
        uc.log_event(
            db,
            event_type,
            actor_type="admin",
            actor_id=None,
            request_id=payload.get("request_id"),
            tool_item_id=None,
            payload=payload,
        )
        db.commit()
    mqtt.publish(topic, payload, qos=1)
    return payload


def _latest_event_payload(db: Session, event_type: str) -> dict | None:
    row = (
        db.execute(
            select(models.Event)
            .where(models.Event.event_type == event_type)
            .order_by(models.Event.ts.desc(), models.Event.event_id.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    if not row:
        return None
    try:
        return json.loads(row.payload_json or "{}")
    except Exception:
        return None


def _resolve_cake_key(db: Session, cake_num: int) -> str:
    candidates = [
        f"cake_{cake_num}",
        f"cake{cake_num}",
    ]

    for key in candidates:
        if db.get(models.CakeState, key) is not None:
            return key

    row = (
        db.execute(
            select(models.ToolItem.cake_id)
            .where(models.ToolItem.cake_id.in_(candidates))
            .limit(1)
        )
        .first()
    )
    if row and row[0]:
        return str(row[0])

    return f"cake_{cake_num}"


def _moonraker_json(method: str, path: str, payload: dict | None = None, timeout: float = 3.0) -> dict:
    url = f"{MOONRAKER_URL}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(url=url, data=data, headers=headers, method=method)
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except Exception:
        return {}


def _direct_machine_status() -> dict | None:
    q = "toolhead=homed_axes,position&idle_timeout=state&print_stats=state,message"
    out = _moonraker_json("GET", f"/printer/objects/query?{q}")
    status = (out.get("result") or {}).get("status") or {}
    if not status:
        return None
    toolhead = status.get("toolhead") or {}
    idle_timeout = status.get("idle_timeout") or {}
    print_stats = status.get("print_stats") or {}
    homed_axes = str(toolhead.get("homed_axes") or "")
    pos = toolhead.get("position") or []
    x = pos[0] if len(pos) > 0 else None
    y = pos[1] if len(pos) > 1 else None
    z = pos[2] if len(pos) > 2 else None
    return {
        "ok": True,
        "reachable": True,
        "state": print_stats.get("state") or idle_timeout.get("state") or "unknown",
        "busy": str(idle_timeout.get("state") or "").lower() != "idle",
        "homed": bool(homed_axes),
        "homed_axes": homed_axes,
        "horizontal_position": x,
        "vertical_position": z,
        "active_cake_id": None,
        "position": pos,
        "print_message": print_stats.get("message"),
        "source": "moonraker_direct",
    }


def _coerce_manual_status(payload: dict | None) -> dict:
    payload = payload or {}
    pos = payload.get("position") or payload.get("machine", {}).get("position") or []
    x = pos[0] if isinstance(pos, list) and len(pos) > 0 else payload.get("horizontal_position")
    z = pos[2] if isinstance(pos, list) and len(pos) > 2 else payload.get("vertical_position")
    return {
        "ok": True,
        "reachable": payload.get("reachable", False),
        "state": payload.get("state") or payload.get("machine", {}).get("state") or "unknown",
        "busy": payload.get("busy", False),
        "homed": payload.get("homed", False),
        "horizontal_position": x,
        "vertical_position": z,
        "active_cake_id": payload.get("active_cake_id"),
        "position": pos if isinstance(pos, list) else [],
        "error": payload.get("error"),
        "source": payload.get("source", "mqtt_cache"),
    }


def _resolve_klipper_file(name: str) -> Path:
    path = ALLOWED_KLIPPER_FILES.get(name)
    if not path:
        raise HTTPException(status_code=400, detail="invalid_klipper_filename")
    return path


def _read_klipper_file(path: Path) -> str:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"klipper_file_not_found:{path}")
    try:
        return path.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"klipper_file_read_failed:{e}")


def _write_klipper_file_atomic(path: Path, content: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)

        if path.exists():
            backup_path = path.with_suffix(path.suffix + ".bak")
            shutil.copy2(path, backup_path)

        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(content, encoding="utf-8")
        tmp_path.replace(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"klipper_file_write_failed:{e}")



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


@router.post("/tool-items/{tool_item_id}/drop-unconfirmed")
def drop_unconfirmed_tool_item(tool_item_id: str, db: Session = Depends(get_db)):
    return uc.drop_unconfirmed_tool_item(db, tool_item_id)


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


@router.get("/cakes/{cake_id}/eeprom")
def read_cake_eeprom(cake_id: int, db: Session = Depends(get_db)):
    row = (
        db.execute(
            select(models.Event)
            .where(models.Event.event_type == "mqtt:igen/evt/admin/calibration")
            .order_by(models.Event.ts.desc(), models.Event.event_id.desc())
        )
        .scalars()
        .all()
    )

    for ev in row:
        try:
            payload = json.loads(ev.payload_json or "{}")
        except Exception:
            continue

        if payload.get("action") == "encoder_read_eeprom" and int(payload.get("cake_id", -1)) == cake_id:
            return {
                "ok": payload.get("stage") == "succeeded",
                "cake_id": cake_id,
                "stage": payload.get("stage"),
                "request_id": payload.get("request_id"),
                "error_code": payload.get("error_code"),
                "error_reason": payload.get("error_reason"),
                "eeprom": payload.get("eeprom"),
            }

    return {"ok": False, "cake_id": cake_id, "eeprom": None, "detail": "no_eeprom_read_yet"}


@router.post("/cakes/{cake_id}/read-angle")
def queue_cake_read_angle(cake_id: int, request: Request, db: Session = Depends(get_db)):
    request_id = _new_request_id("cal")

    payload = {
        "request_id": request_id,
        "action": "encoder_read",
        "cake_id": cake_id,
    }

    _publish_admin_command(
        request,
        topic="igen/cmd/admin/calibration",
        payload=payload,
        event_type="admin:cake_read_angle_requested",
        db=db,
    )

    return {"ok": True, "request_id": request_id, "cake_id": cake_id}


@router.get("/cakes/{cake_id}/angle")
def read_cake_angle(cake_id: int, db: Session = Depends(get_db)):
    rows = (
        db.execute(
            select(models.Event)
            .where(models.Event.event_type == "mqtt:igen/evt/admin/calibration")
            .order_by(models.Event.ts.desc(), models.Event.event_id.desc())
        )
        .scalars()
        .all()
    )

    for ev in rows:
        try:
            payload = json.loads(ev.payload_json or "{}")
        except Exception:
            continue

        if payload.get("action") in {"encoder_read", "encoder_read_angle"} and int(payload.get("cake_id", -1)) == cake_id:
            return {
                "ok": payload.get("stage") == "succeeded",
                "cake_id": cake_id,
                "stage": payload.get("stage"),
                "request_id": payload.get("request_id"),
                "error_code": payload.get("error_code"),
                "error_reason": payload.get("error_reason"),
                "reading": payload.get("reading"),
            }

    return {"ok": False, "cake_id": cake_id, "reading": None, "detail": "no_angle_read_yet"}


@router.post("/loans/{loan_id}/confirm")
def admin_confirm_loan(loan_id: str, db: Session = Depends(get_db)):
    return uc.admin_confirm_unconfirmed_loan(db, loan_id)


@router.post("/loans/{loan_id}/cancel-unconfirmed")
def admin_cancel_unconfirmed_loan(loan_id: str, db: Session = Depends(get_db)):
    return uc.admin_cancel_unconfirmed_loan(db, loan_id)



# ---------------- MANUAL CONTROL / MACHINE ----------------
@router.get("/manual/status", response_model=schemas.ManualControlStatus)
def manual_status(db: Session = Depends(get_db)):
    direct = _direct_machine_status()
    if direct:
        return direct

    cached = _latest_event_payload(db, "mqtt:igen/evt/machine/status")
    if cached:
        return _coerce_manual_status(cached)

    return {
        "ok": True,
        "reachable": False,
        "state": "unknown",
        "busy": False,
        "homed": False,
        "horizontal_position": None,
        "vertical_position": None,
        "active_cake_id": None,
        "position": [],
        "error": "no_machine_status_yet",
        "source": "none",
    }


@router.post("/manual/home-all", response_model=schemas.ManualCommandResp)
def manual_home_all(
    request: Request,
    body: dict | None = Body(default=None),
    db: Session = Depends(get_db),
):
    home_mode = str((body or {}).get("home_mode") or "python_assisted")

    payload = {
        "request_id": _new_request_id("adm"),
        "action": "home_machine",
        "home_mode": home_mode,
    }
    _publish_admin_command(
        request,
        topic="igen/cmd/admin/manual",
        payload=payload,
        event_type="admin:manual_home_all_requested",
        db=db,
    )
    return {
        "ok": True,
        "message": f"Queued home machine command ({home_mode})",
        "request_id": payload["request_id"],
        "command": payload["action"],
        "data": {"home_mode": home_mode},
    }


@router.post("/manual/go-to-door", response_model=schemas.ManualCommandResp)
def manual_go_to_door(request: Request, db: Session = Depends(get_db)):
    payload = {
        "request_id": _new_request_id("adm"),
        "action": "move_to_door",
    }
    _publish_admin_command(
        request,
        topic="igen/cmd/admin/manual",
        payload=payload,
        event_type="admin:manual_go_to_door_requested",
        db=db,
    )
    return {
        "ok": True,
        "message": "Queued move-to-door command",
        "request_id": payload["request_id"],
        "command": payload["action"],
    }


@router.post("/manual/stop", response_model=schemas.ManualCommandResp)
def manual_stop(request: Request, db: Session = Depends(get_db)):
    payload = {
        "request_id": _new_request_id("adm"),
        "action": "emergency_stop",
    }
    _publish_admin_command(
        request,
        topic="igen/cmd/admin/machine",
        payload=payload,
        event_type="admin:manual_stop_requested",
        db=db,
    )
    return {
        "ok": True,
        "message": "Queued emergency stop command",
        "request_id": payload["request_id"],
        "command": payload["action"],
    }


@router.post("/manual/jog-axis", response_model=schemas.ManualCommandResp)
def manual_jog_axis(body: schemas.ManualJogAxisReq, request: Request, db: Session = Depends(get_db)):
    payload = {
        "request_id": _new_request_id("adm"),
        "action": "jog_axis",
        "axis": body.axis,
        "direction": body.direction,
        "distance": body.step,
    }
    _publish_admin_command(
        request,
        topic="igen/cmd/admin/manual",
        payload=payload,
        event_type="admin:manual_jog_axis_requested",
        db=db,
    )
    return {
        "ok": True,
        "message": f"Queued jog {body.axis} {body.direction} by {body.step}",
        "request_id": payload["request_id"],
        "command": payload["action"],
        "data": {"axis": body.axis, "direction": body.direction, "distance": body.step},
    }


@router.post("/manual/move-cake", response_model=schemas.ManualCommandResp)
def manual_move_cake(body: schemas.ManualMoveCakeReq, request: Request, db: Session = Depends(get_db)):
    cake_key = _resolve_cake_key(db, body.cake_id)
    current_slot = get_cake_current_slot(db, cake_key)
    signed_step = body.step if body.direction == "cw" else -body.step
    target_slot = normalize_slot(current_slot + signed_step)

    payload = {
        "request_id": _new_request_id("adm"),
        "action": "move_cake",
        "cake_id": body.cake_id,
        "current_slot": current_slot,
        "target_slot": target_slot,
    }

    _publish_admin_command(
        request,
        topic="igen/cmd/admin/manual",
        payload=payload,
        event_type="admin:manual_move_cake_requested",
        db=db,
    )

    set_cake_current_slot(db, cake_key, target_slot)
    db.commit()

    return {
        "ok": True,
        "message": f"Queued move cake {body.cake_id} from slot {current_slot} to slot {target_slot}",
        "request_id": payload["request_id"],
        "command": payload["action"],
        "data": {
            "cake_id": body.cake_id,
            "cake_key": cake_key,
            "current_slot": current_slot,
            "target_slot": target_slot,
        },
    }


@router.get("/machine/status", response_model=schemas.ManualControlStatus)
def machine_status(db: Session = Depends(get_db)):
    direct = _direct_machine_status()
    if direct:
        return direct
    cached = _latest_event_payload(db, "mqtt:igen/evt/machine/status")
    if cached:
        return _coerce_manual_status(cached)
    return {
        "ok": True,
        "reachable": False,
        "state": "unknown",
        "busy": False,
        "homed": False,
        "horizontal_position": None,
        "vertical_position": None,
        "active_cake_id": None,
        "position": [],
        "error": "no_machine_status_yet",
        "source": "none",
    }


@router.post("/machine/query-status", response_model=schemas.ManualCommandResp)
def machine_query_status(request: Request, db: Session = Depends(get_db)):
    payload = {
        "request_id": _new_request_id("mach"),
        "action": "query_status",
    }
    _publish_admin_command(
        request,
        topic="igen/cmd/admin/machine",
        payload=payload,
        event_type="admin:machine_query_status_requested",
        db=db,
    )
    return {
        "ok": True,
        "message": "Queued machine status query",
        "request_id": payload["request_id"],
        "command": payload["action"],
    }


@router.post("/machine/restart-klipper", response_model=schemas.ManualCommandResp)
def machine_restart_klipper(request: Request, db: Session = Depends(get_db)):
    payload = {
        "request_id": _new_request_id("mach"),
        "action": "restart_klipper",
    }
    _publish_admin_command(
        request,
        topic="igen/cmd/admin/machine",
        payload=payload,
        event_type="admin:machine_restart_klipper_requested",
        db=db,
    )
    return {
        "ok": True,
        "message": "Queued Klipper restart",
        "request_id": payload["request_id"],
        "command": payload["action"],
    }


@router.post("/machine/firmware-restart", response_model=schemas.ManualCommandResp)
def machine_firmware_restart(request: Request, db: Session = Depends(get_db)):
    payload = {
        "request_id": _new_request_id("mach"),
        "action": "firmware_restart",
    }
    _publish_admin_command(
        request,
        topic="igen/cmd/admin/machine",
        payload=payload,
        event_type="admin:machine_firmware_restart_requested",
        db=db,
    )
    return {
        "ok": True,
        "message": "Queued firmware restart",
        "request_id": payload["request_id"],
        "command": payload["action"],
    }


@router.post("/machine/emergency-stop", response_model=schemas.ManualCommandResp)
def machine_emergency_stop(request: Request, db: Session = Depends(get_db)):
    payload = {
        "request_id": _new_request_id("mach"),
        "action": "emergency_stop",
    }
    _publish_admin_command(
        request,
        topic="igen/cmd/admin/machine",
        payload=payload,
        event_type="admin:machine_emergency_stop_requested",
        db=db,
    )
    return {
        "ok": True,
        "message": "Queued emergency stop",
        "request_id": payload["request_id"],
        "command": payload["action"],
    }


@router.get("/machine/alerts", response_model=list[schemas.MachineAlertOut])
def machine_alerts(
    db: Session = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
):
    rows = db.execute(
        select(models.Event)
        .where(models.Event.event_type == "mqtt:igen/evt/machine/alert")
        .order_by(models.Event.ts.desc(), models.Event.event_id.desc())
        .limit(limit)
    ).scalars().all()

    out = []
    for row in rows:
        try:
            payload = json.loads(row.payload_json or "{}")
        except Exception:
            payload = {}
        out.append({
            "event_id": row.event_id,
            "ts": row.ts,
            "severity": payload.get("severity", "warning"),
            "style": payload.get("style"),
            "code": payload.get("code"),
            "message": payload.get("message", ""),
            "related_request_id": payload.get("related_request_id"),
            "data": payload.get("data", {}),
            "sticky": bool(payload.get("sticky", False)),
            "ack_required": bool(payload.get("ack_required", False)),
            "source": payload.get("source"),
        })
    return out


@router.get("/calibration/status")
def calibration_status(db: Session = Depends(get_db)):
    cached = _latest_event_payload(db, "mqtt:igen/evt/machine/status") or {}
    return {
        "ok": True,
        "source": "placeholder",
        "machine_status": _coerce_manual_status(cached),
        "variables": {},
    }


@router.post("/calibration/set", response_model=schemas.ManualCommandResp)
def calibration_set(body: schemas.AdminCalibrationSetReq, request: Request, db: Session = Depends(get_db)):
    payload = {
        "request_id": _new_request_id("cal"),
        "action": body.action or "set_variable",
        "variable": body.variable,
        "value": body.value,
    }
    if body.cake_id is not None:
        payload["cake_id"] = body.cake_id
    _publish_admin_command(
        request,
        topic="igen/cmd/admin/calibration",
        payload=payload,
        event_type="admin:calibration_set_requested",
        db=db,
    )
    return {
        "ok": True,
        "message": f"Queued calibration write for {body.variable or body.action}",
        "request_id": payload["request_id"],
        "command": payload["action"],
        "data": payload,
    }


@router.get("/klipper/file")
def get_klipper_file(name: str):
    path = _resolve_klipper_file(name)
    return {
        "ok": True,
        "name": name,
        "path": str(path),
        "content": _read_klipper_file(path),
    }


@router.post("/klipper/file")
def save_klipper_file(
    body: dict = Body(...),
    db: Session = Depends(get_db),
):
    name = str(body.get("name") or "").strip()
    content = str(body.get("content") or "")

    if not name:
        raise HTTPException(status_code=400, detail="name_required")
    if not content.strip():
        raise HTTPException(status_code=400, detail="empty_file_not_allowed")

    path = _resolve_klipper_file(name)
    _write_klipper_file_atomic(path, content)

    uc.log_event(
        db,
        "admin:klipper_file_saved",
        actor_type="admin",
        actor_id=None,
        request_id=None,
        tool_item_id=None,
        payload={
            "name": name,
            "path": str(path),
            "size_bytes": len(content.encode("utf-8")),
        },
    )
    db.commit()

    return {
        "ok": True,
        "name": name,
        "path": str(path),
        "message": f"Saved {name}",
    }


@router.post("/klipper/restart")
def klipper_restart(
    request: Request,
    body: dict | None = Body(default=None),
    db: Session = Depends(get_db),
):
    mode = str((body or {}).get("mode") or "restart_klipper").strip()
    if mode not in {"restart_klipper", "firmware_restart"}:
        raise HTTPException(status_code=400, detail="invalid_restart_mode")

    payload = {
        "request_id": _new_request_id("mach"),
        "action": mode,
    }

    _publish_admin_command(
        request,
        topic="igen/cmd/admin/machine",
        payload=payload,
        event_type="admin:klipper_restart_requested",
        db=db,
    )

    return {
        "ok": True,
        "message": f"Queued {mode}",
        "request_id": payload["request_id"],
        "command": payload["action"],
    }

# ---------------- HARDWARE STATUS / CONSOLE ----------------

@router.post("/cakes/{cake_id}/home")
def cake_set_home(cake_id: int, request: Request, db: Session = Depends(get_db)):
    request_id = uuid.uuid4().hex

    set_cake_cmd_status(request_id, {
        "request_id": request_id,
        "cake_id": cake_id,
        "stage": "queued",
        "error_code": None,
        "error_reason": None,
    })

    payload = {
        "request_id": request_id,
        "action": "set_cake_zero",
        "cake_id": cake_id,
    }

    _publish_admin_command(
        request,
        topic="igen/cmd/admin/manual",
        payload=payload,
        event_type="admin:cake_set_home_requested",
        db=db,
    )

    print("CAKE HOME CMD SENT")

    return {"ok": True, "request_id": request_id, "cake_id": cake_id}


@router.post("/cakes/{cake_id}/read-eeprom")
def queue_cake_read_eeprom(cake_id: int, request: Request, db: Session = Depends(get_db)):
    request_id = _new_request_id("cal")

    payload = {
        "request_id": request_id,
        "action": "encoder_read_eeprom",
        "cake_id": cake_id,
    }

    _publish_admin_command(
        request,
        topic="igen/cmd/admin/calibration",
        payload=payload,
        event_type="admin:cake_read_eeprom_requested",
        db=db,
    )

    return {"ok": True, "request_id": request_id, "cake_id": cake_id}


@router.get("/cakes/home/{request_id}/status")
def cake_set_home_status(request_id: str, db: Session = Depends(get_db)):
    rows = (
        db.execute(
            select(models.Event)
            .where(models.Event.event_type == "mqtt:igen/evt/admin/manual")
            .order_by(models.Event.ts.desc(), models.Event.event_id.desc())
            .limit(100)
        )
        .scalars()
        .all()
    )

    matched_payload = None
    for row in rows:
        try:
            payload = json.loads(row.payload_json or "{}")
        except Exception:
            continue
        if payload.get("request_id") == request_id:
            matched_payload = payload
            break

    if matched_payload:
        stage = matched_payload.get("stage")
        cake_id = matched_payload.get("cake_id")

        data = matched_payload.get("data") or {}
        if cake_id is None and isinstance(data, dict):
            cake_id = data.get("cake_id")

        set_cake_cmd_status(request_id, {
            "request_id": request_id,
            "cake_id": cake_id,
            "stage": stage or "unknown",
            "error_code": matched_payload.get("error_code"),
            "error_reason": matched_payload.get("error_reason"),
        })

    st = get_cake_cmd_status(request_id)
    if not st:
        raise HTTPException(status_code=404, detail="unknown request_id")

    if st.get("stage") == "succeeded":
        cake_id = st.get("cake_id")
        if cake_id is not None:
            cake_key = _resolve_cake_key(db, int(cake_id))
            current_slot = get_cake_current_slot(db, cake_key)
            if current_slot != 0:
                try:
                    from ..usecases.user_flow import remap_cake_home
                    remap_cake_home(db, cake_key, current_slot)
                    db.commit()
                except Exception as e:
                    raise HTTPException(status_code=400, detail=str(e))

    return st


@router.post("/loans/{loan_id}/send-overdue-email")
def send_overdue_email_alert(loan_id: str, db: Session = Depends(get_db)):
    loan = db.get(models.Loan, loan_id)
    if not loan:
        raise HTTPException(404, "loan not found")

    user = db.get(models.User, loan.user_id)
    if not user:
        raise HTTPException(404, "user not found")

    tool_item = db.get(models.ToolItem, loan.tool_item_id)
    if not tool_item:
        raise HTTPException(404, "tool item not found")

    tool_model = db.get(models.ToolModel, tool_item.tool_model_id) if tool_item.tool_model_id else None
    tool_name = getattr(tool_model, "name", None) or tool_item.tool_model_id or loan.tool_item_id

    # hardcoded recipient for now; replace later
    to_email = "brandon.alexander.jong@gmail.com"

    overdue_hours = 0.0
    if loan.due_at:
        overdue_hours = max(0.0, round((datetime.now() - loan.due_at).total_seconds() / 3600.0, 1))

    user_name = "there"
    first_name = getattr(user, "first_name", None) or ""
    last_name = getattr(user, "last_name", None) or ""
    full_name = f"{first_name} {last_name}".strip()
    if full_name:
        user_name = full_name

    try:
        res = send_template(
            to=to_email,
            template_name="overdue_loan_notice",
            context={
                "user_name": user_name,
                "user_id": user.user_id,
                "tool_name": tool_name,
                "tool_item_id": loan.tool_item_id,
                "loan_id": loan.loan_id,
                "due_at": loan.due_at.isoformat() if loan.due_at else "",
                "overdue_hours": overdue_hours,
                "support_email": os.getenv("SENDGRID_FROM_EMAIL", "noreply@example.com"),
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"failed_to_send_overdue_email:{e}")

    uc.log_event(
        db,
        "admin:overdue_email_alert_sent",
        actor_type="admin",
        actor_id=None,
        request_id=None,
        tool_item_id=getattr(loan, "tool_item_id", None),
        payload={
            "loan_id": loan_id,
            "user_id": getattr(loan, "user_id", None),
            "to_email": to_email,
            "tool_name": tool_name,
            "sendgrid_result": {
                "ok": res.get("ok"),
                "status_code": res.get("status_code"),
                "message": res.get("message"),
            },
        },
    )
    db.commit()

    return {
        "ok": True,
        "loan_id": loan_id,
        "message": f"Overdue email sent to {to_email} for {tool_name}",
    }
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
        COALESCE(COUNT(ti.tool_item_id), 0) AS total,
        COALESCE(SUM(CASE WHEN open_loan.tool_item_id IS NULL THEN 1 ELSE 0 END), 0) AS available,
        COALESCE(SUM(CASE WHEN open_loan.tool_item_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS checked_out
      FROM tool_models tm
      LEFT JOIN tool_items ti
        ON ti.tool_model_id = tm.tool_model_id
       AND ti.is_active = 1
      LEFT JOIN (
        SELECT tool_item_id
        FROM loans
        WHERE returned_at IS NULL
        GROUP BY tool_item_id
      ) open_loan
        ON open_loan.tool_item_id = ti.tool_item_id
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


@router.get("/cakes")
def cakes_overview(db: Session = Depends(get_db)):
    return {"cakes": get_cake_overview(db)}


@router.get("/emails/templates")
def email_templates():
    return {"templates": list_templates()}


@router.post("/emails/send")
def admin_send_email(body: dict):
    to = str(body.get("to") or "").strip()
    subject = str(body.get("subject") or "").strip()
    message = str(body.get("message") or "").strip()
    if not to or not subject or not message:
        raise HTTPException(status_code=400, detail="to_subject_message_required")
    return send_email(to=to, subject=subject, body=message)


@router.post("/emails/send-template")
def admin_send_template(body: dict):
    to = str(body.get("to") or "").strip()
    template_name = str(body.get("template_name") or "").strip()
    context = body.get("context") or {}
    if not to or not template_name:
        raise HTTPException(status_code=400, detail="to_template_required")
    try:
        return send_template(to=to, template_name=template_name, context=context)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/machine/waits")
def machine_waits():
    return {"ok": True, "waits": []}

@router.post("/manual/run-macro", response_model=schemas.ManualCommandResp)
def manual_run_macro(
    body: schemas.ManualRunMacroReq,
    request: Request,
    db: Session = Depends(get_db),
):
    script = (body.script or "").strip()
    if not script:
        raise HTTPException(status_code=400, detail="script_required")
    if "\n" in script or "\r" in script:
        raise HTTPException(status_code=400, detail="multiline_gcode_not_allowed")

    payload = {
        "request_id": _new_request_id("adm"),
        "action": "run_macro",
        "script": script,
    }

    _publish_admin_command(
        request,
        topic="igen/cmd/admin/manual",
        payload=payload,
        event_type="admin:manual_run_macro_requested",
        db=db,
    )

    return {
        "ok": True,
        "message": f"Queued macro: {script}",
        "request_id": payload["request_id"],
        "command": payload["action"],
        "data": {"script": script},
    }


@router.post("/manual/jog-cake-delta", response_model=schemas.ManualCommandResp)
def manual_jog_cake_delta(
    body: schemas.ManualJogCakeDeltaReq,
    request: Request,
    db: Session = Depends(get_db),
):
    if body.delta == 0:
        raise HTTPException(status_code=400, detail="delta_must_not_be_zero")

    payload = {
        "request_id": _new_request_id("adm"),
        "action": "jog_cake_delta",
        "cake_id": body.cake_id,
        "delta": body.delta,
    }

    _publish_admin_command(
        request,
        topic="igen/cmd/admin/manual",
        payload=payload,
        event_type="admin:manual_jog_cake_delta_requested",
        db=db,
    )

    return {
        "ok": True,
        "message": f"Queued cake {body.cake_id} jog delta {body.delta}",
        "request_id": payload["request_id"],
        "command": payload["action"],
        "data": {"cake_id": body.cake_id, "delta": body.delta},
    }
