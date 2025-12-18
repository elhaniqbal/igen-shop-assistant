from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..usecases.rfid_flow import confirm_tool_receipt
from .deps import get_db

router = APIRouter(prefix="/api/rfid", tags=["rfid"])

@router.post("/tool-confirm")
def tool_confirm(req: schemas.ToolConfirmRequest, db: Session = Depends(get_db)):
    try:
        out = confirm_tool_receipt(db, req.user_id, req.tool_tag_id)
        return {"ok": True, **out}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
