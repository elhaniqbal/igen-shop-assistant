from __future__ import annotations

import re
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models

ALLOWED_USER_STATUSES = ("good", "active", "delinquent")
ACTIVE_LOAN_STATUSES = ("active", "overdue", "unconfirmed")
RESERVED_HW_STATUSES = ("pending", "accepted", "in_progress", "waiting_user_confirm")
SLOTS_PER_CAKE = 6


def now() -> datetime:
    return datetime.now()


def parse_cake_num(cake_id: str) -> int:
    m = re.search(r"(\d+)", str(cake_id))
    if not m:
        raise ValueError(f"invalid_cake_id:{cake_id}")
    return int(m.group(1))


def parse_slot_index(slot_id: str) -> int:
    m = re.search(r"(\d+)", str(slot_id))
    if not m:
        raise ValueError(f"invalid_slot_id:{slot_id}")
    return int(m.group(1)) % SLOTS_PER_CAKE


def normalize_slot(slot: int) -> int:
    return int(slot) % SLOTS_PER_CAKE


def next_slot(slot: int) -> int:
    return normalize_slot(slot + 1)


def prev_slot(slot: int) -> int:
    return normalize_slot(slot - 1)


def must_user_active(db: Session, user_id: str) -> models.User:
    u = db.get(models.User, user_id)
    if not u:
        raise ValueError("invalid_user")
    if u.status == "banned" or u.status not in ALLOWED_USER_STATUSES:
        raise ValueError("invalid_user")
    return u


def _ensure_slot_state_seeded(db: Session, tool: models.ToolItem):
    slot_index = parse_slot_index(tool.slot_id)
    state = db.get(models.CakeSlotState, {"cake_id": tool.cake_id, "slot_index": slot_index})
    if state is None:
        db.add(models.CakeSlotState(cake_id=tool.cake_id, slot_index=slot_index, tool_item_id=tool.tool_item_id))


def _ensure_cake_state_seeded(db: Session, cake_id: str):
    row = db.get(models.CakeState, cake_id)
    if row is None:
        db.add(models.CakeState(cake_id=cake_id, current_slot=0))


def get_cake_current_slot(db: Session, cake_id: str) -> int:
    _ensure_cake_state_seeded(db, cake_id)
    db.flush()
    row = db.get(models.CakeState, cake_id)
    assert row is not None
    return int(row.current_slot)


def set_cake_current_slot(db: Session, cake_id: str, slot: int):
    _ensure_cake_state_seeded(db, cake_id)
    db.flush()
    row = db.get(models.CakeState, cake_id)
    assert row is not None
    row.current_slot = normalize_slot(slot)


def _is_tool_item_available(db: Session, tool_item_id: str) -> bool:
    active = db.execute(
        select(models.Loan).where(
            models.Loan.tool_item_id == tool_item_id,
            models.Loan.returned_at.is_(None),
            models.Loan.status.in_(ACTIVE_LOAN_STATUSES),
        )
    ).scalar_one_or_none()
    if active:
        return False
    reserved = db.execute(
        select(models.LoanRequest).where(
            models.LoanRequest.tool_item_id == tool_item_id,
            models.LoanRequest.request_type == "dispense",
            models.LoanRequest.hw_status.in_(RESERVED_HW_STATUSES),
        )
    ).scalar_one_or_none()
    return reserved is None


def _current_slot_for_tool(db: Session, tool_item_id: str) -> int:
    row = db.execute(select(models.CakeSlotState).where(models.CakeSlotState.tool_item_id == tool_item_id)).scalar_one_or_none()
    if not row:
        tool = db.get(models.ToolItem, tool_item_id)
        if not tool:
            raise ValueError("invalid_tool_item")
        return parse_slot_index(tool.slot_id)
    return int(row.slot_index)


def _allocate_tool_item_for_model(db: Session, tool_model_id: str) -> models.ToolItem | None:
    candidates = db.execute(
        select(models.ToolItem).where(
            models.ToolItem.tool_model_id == tool_model_id,
            models.ToolItem.is_active.is_(True),
        )
    ).scalars().all()

    preferred: list[tuple[int, models.ToolItem]] = []
    fallback: list[models.ToolItem] = []
    for ti in candidates:
        _ensure_slot_state_seeded(db, ti)
        _ensure_cake_state_seeded(db, ti.cake_id)
        if not _is_tool_item_available(db, ti.tool_item_id):
            continue
        current_cake_slot = get_cake_current_slot(db, ti.cake_id)
        target_slot = next_slot(current_cake_slot)
        if _current_slot_for_tool(db, ti.tool_item_id) == target_slot:
            preferred.append((parse_cake_num(ti.cake_id), ti))
        else:
            fallback.append(ti)

    if preferred:
        preferred.sort(key=lambda x: x[0])
        return preferred[0][1]
    return fallback[0] if fallback else None


def _allocate_return_slot(db: Session, cake_id: str) -> int:
    current = get_cake_current_slot(db, cake_id)
    preferred = prev_slot(current)
    state = db.get(models.CakeSlotState, {"cake_id": cake_id, "slot_index": preferred})
    if state is None or state.tool_item_id is None:
        return preferred
    occupied = {
        row.slot_index
        for row in db.execute(
            select(models.CakeSlotState).where(
                models.CakeSlotState.cake_id == cake_id,
                models.CakeSlotState.tool_item_id.is_not(None),
            )
        ).scalars().all()
    }
    for offset in range(1, SLOTS_PER_CAKE + 1):
        idx = normalize_slot(current - offset)
        if idx not in occupied:
            return idx
    raise ValueError(f"no_free_slot:{cake_id}")


def create_dispense_batch(db: Session, user_id: str, items: list[dict], loan_period_hours: int):
    must_user_active(db, user_id)
    if not items:
        raise ValueError("no_items")
    batch_id = models.new_id("batch")
    request_ids: list[str] = []
    idx = 0
    for item in items:
        tool_model_id = item.get("tool_model_id")
        qty = int(item.get("qty", 1))
        if not tool_model_id:
            raise ValueError("missing_tool_model_id")
        for _ in range(qty):
            ti = _allocate_tool_item_for_model(db, tool_model_id)
            if not ti:
                raise ValueError(f"not_enough_available_items:{tool_model_id}")
            idx += 1
            rid = f"{batch_id}_item_{idx}"
            request_ids.append(rid)
            target_slot = _current_slot_for_tool(db, ti.tool_item_id)
            db.add(models.LoanRequest(
                request_id=rid,
                batch_id=batch_id,
                request_type="dispense",
                user_id=user_id,
                tool_item_id=ti.tool_item_id,
                slot_id=str(target_slot),
                loan_period_hours=loan_period_hours,
                hw_status="pending",
                created_at=now(),
            ))
    db.commit()
    return {"batch_id": batch_id, "request_ids": request_ids}


def create_return_batch(db: Session, user_id: str, items: list[dict]):
    must_user_active(db, user_id)
    if not items:
        raise ValueError("no_items")
    batch_id = models.new_id("retbatch")
    request_ids: list[str] = []
    idx = 0
    for item in items:
        tool_item_id = item.get("tool_item_id")
        if not tool_item_id:
            raise ValueError("missing_tool_item_id")
        loan = db.execute(
            select(models.Loan).where(
                models.Loan.user_id == user_id,
                models.Loan.tool_item_id == tool_item_id,
                models.Loan.returned_at.is_(None),
                models.Loan.status.in_(("active", "overdue", "unconfirmed")),
            )
        ).scalar_one_or_none()
        if not loan:
            raise ValueError("invalid_loan")
        tool = db.get(models.ToolItem, tool_item_id)
        if not tool:
            raise ValueError("invalid_tool_item")
        idx += 1
        rid = f"{batch_id}_item_{idx}"
        request_ids.append(rid)
        target_slot = _allocate_return_slot(db, tool.cake_id)
        db.add(models.LoanRequest(
            request_id=rid,
            batch_id=batch_id,
            request_type="return",
            user_id=user_id,
            tool_item_id=tool_item_id,
            slot_id=str(target_slot),
            hw_status="pending",
            created_at=now(),
        ))
    db.commit()
    return {"batch_id": batch_id, "request_ids": request_ids}


def build_hw_payload(db: Session, request_id: str) -> dict:
    lr = db.get(models.LoanRequest, request_id)
    if not lr:
        raise ValueError("invalid_request")
    tool = db.get(models.ToolItem, lr.tool_item_id)
    if not tool:
        raise ValueError("invalid_tool_item")
    current_slot = get_cake_current_slot(db, tool.cake_id)
    target_slot = parse_slot_index(lr.slot_id)
    return {
        "request_id": lr.request_id,
        "batch_id": lr.batch_id,
        "action": lr.request_type,
        "user_id": lr.user_id,
        "tool_item_id": lr.tool_item_id,
        "cake_id": parse_cake_num(tool.cake_id),
        "current_slot": current_slot,
        "target_slot": target_slot,
        "loan_period_hours": lr.loan_period_hours,
        "ts": lr.created_at.isoformat() + "Z",
    }


def get_batch_status(db: Session, batch_id: str):
    rows = db.execute(select(models.LoanRequest).where(models.LoanRequest.batch_id == batch_id)).scalars().all()
    return [{
        "request_id": r.request_id,
        "request_type": r.request_type,
        "tool_item_id": r.tool_item_id,
        "slot_id": r.slot_id,
        "hw_status": r.hw_status,
        "hw_error_code": r.hw_error_code,
        "hw_error_reason": r.hw_error_reason,
        "created_at": r.created_at.isoformat(),
        "hw_updated_at": r.hw_updated_at.isoformat() if r.hw_updated_at else None,
    } for r in rows]


def list_active_loans(db: Session, user_id: str):
    rows = db.execute(
        select(models.Loan, models.ToolItem.tool_model_id, models.ToolItem.tool_tag_id, models.ToolModel.name, models.ToolModel.category)
        .join(models.ToolItem, models.ToolItem.tool_item_id == models.Loan.tool_item_id)
        .join(models.ToolModel, models.ToolModel.tool_model_id == models.ToolItem.tool_model_id)
        .where(models.Loan.user_id == user_id, models.Loan.returned_at.is_(None), models.Loan.status.in_(("active","overdue","unconfirmed")))
        .order_by(models.Loan.issued_at.desc())
    ).all()
    return [{
        "loan_id": loan.loan_id,
        "tool_item_id": loan.tool_item_id,
        "tool_model_id": tool_model_id,
        "tool_name": tool_name,
        "tool_category": tool_category,
        "tool_tag_id": tool_tag_id,
        "issued_at": loan.issued_at.isoformat(),
        "due_at": loan.due_at.isoformat(),
        "confirmed_at": loan.confirmed_at.isoformat() if loan.confirmed_at else None,
        "returned_at": loan.returned_at.isoformat() if loan.returned_at else None,
        "status": loan.status,
    } for loan, tool_model_id, tool_tag_id, tool_name, tool_category in rows]


def get_cake_overview(db: Session):
    cakes = db.execute(select(models.CakeState).order_by(models.CakeState.cake_id.asc())).scalars().all()
    out = []
    for cake in cakes:
        slots = db.execute(
            select(models.CakeSlotState).where(models.CakeSlotState.cake_id == cake.cake_id).order_by(models.CakeSlotState.slot_index.asc())
        ).scalars().all()
        out.append({
            "cake_id": cake.cake_id,
            "current_slot": cake.current_slot,
            "slots": [
                {"slot_index": s.slot_index, "tool_item_id": s.tool_item_id}
                for s in slots
            ],
        })
    return out
