from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, Literal
from ..mqtt import MqttBus
from .. import schemas
from ..usecases.rfid_flow import confirm_tool_receipt
from .deps import get_db, get_mqtt
import threading 

router = APIRouter(prefix="/api/rfid", tags=["rfid"])
# --- RFID inbox (ephemeral) ---
_RFID_LOCK = threading.Lock()
_RFID_LAST: dict[tuple[str, str], dict] = {}  # key=(reader_id, kind) kind in {"card","tool"}

@router.post("/tool-confirm")
def tool_confirm(req: schemas.ToolConfirmRequest, db: Session = Depends(get_db)):
    try:
        out = confirm_tool_receipt(db, req.user_id, req.tool_tag_id)
        return {"ok": True, **out}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))



def _rfid_pop(reader_id: str, kind: str) -> Optional[dict]:
    with _RFID_LOCK:
        return _RFID_LAST.pop((reader_id, kind), None)

def _rfid_get(reader_id: str, kind: str) -> Optional[dict]:
    with _RFID_LOCK:
        return _RFID_LAST.get((reader_id, kind))
@router.post("/rfid/set-mode")
def rfid_set_mode(req: schemas.RfidSetModeReq, mqtt: MqttBus = Depends(get_mqtt)):
    # Optional but clean: tells the RFID service what scan type to expect next
    mqtt.publish("igen/cmd/rfid/set_mode", {"reader_id": req.reader_id, "mode": req.mode}, qos=1)
    return {"ok": True}

@router.get("/rfid/consume")
def rfid_consume(reader_id: str, kind: Literal["card", "tool"]):
    scan = _rfid_pop(reader_id, kind)
    return {"ok": bool(scan), "scan": scan}

@router.get("/rfid/peek")
def rfid_peek(reader_id: str, kind: Literal["card", "tool"]):
    scan = _rfid_get(reader_id, kind)
    return {"ok": True, "scan": scan}