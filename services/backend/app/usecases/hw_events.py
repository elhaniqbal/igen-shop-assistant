from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models


def now():
    return datetime.now()


def _parse_slot(value) -> int:
    try:
        return int(value)
    except Exception:
        return 0


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
    elif stage in {"waiting_user_confirm", "door_take_confirm"}:
        req.hw_status = "waiting_user_confirm"
    elif stage == "succeeded":
        req.hw_status = "dispensed_ok"

        tool = db.get(models.ToolItem, req.tool_item_id)
        if tool:
            slot_index = _parse_slot(req.slot_id)
            slot_state = db.get(models.CakeSlotState, {"cake_id": tool.cake_id, "slot_index": slot_index})
            if slot_state is None:
                slot_state = models.CakeSlotState(cake_id=tool.cake_id, slot_index=slot_index, tool_item_id=None)
                db.add(slot_state)
            slot_state.tool_item_id = None

            cake_state = db.get(models.CakeState, tool.cake_id)
            if cake_state is None:
                cake_state = models.CakeState(cake_id=tool.cake_id, current_slot=slot_index)
                db.add(cake_state)
            cake_state.current_slot = slot_index
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

    if stage == "accepted":
        req.hw_status = "accepted"
        req.hw_updated_at = now()
        db.commit()
        return

    if stage == "in_progress":
        req.hw_status = "in_progress"
        req.hw_updated_at = now()
        db.commit()
        return

    if stage in {"waiting_user_insert", "door_insert_confirm"}:
        req.hw_status = "waiting_user_insert"
        req.hw_updated_at = now()
        db.commit()
        return

    if stage in {"waiting_user_place", "cake_place_confirm"}:
        req.hw_status = "waiting_user_place"
        req.hw_updated_at = now()
        db.commit()
        return

    if stage == "succeeded":
        req.hw_status = "return_ok"
        req.hw_updated_at = now()

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

        tool = db.get(models.ToolItem, req.tool_item_id)
        if tool:
            slot_index = _parse_slot(req.slot_id)
            slot_state = db.get(models.CakeSlotState, {"cake_id": tool.cake_id, "slot_index": slot_index})
            if slot_state is None:
                slot_state = models.CakeSlotState(cake_id=tool.cake_id, slot_index=slot_index, tool_item_id=req.tool_item_id)
                db.add(slot_state)
            slot_state.tool_item_id = req.tool_item_id

            cake_state = db.get(models.CakeState, tool.cake_id)
            if cake_state is None:
                cake_state = models.CakeState(cake_id=tool.cake_id, current_slot=slot_index)
                db.add(cake_state)
            cake_state.current_slot = slot_index

        db.commit()
        return

    if stage == "failed":
        req.hw_status = "failed"
        req.hw_error_code = payload.get("error_code")
        req.hw_error_reason = payload.get("error_reason")
        req.hw_updated_at = now()
        db.commit()
