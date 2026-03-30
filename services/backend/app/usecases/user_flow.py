from __future__ import annotations

import re
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models

ALLOWED_USER_STATUSES = ("good", "active", "delinquent")
ACTIVE_LOAN_STATUSES = ("active", "overdue", "unconfirmed")
RESERVED_HW_STATUSES = ("pending", "accepted", "in_progress", "waiting_user_confirm", "waiting_user_insert", "waiting_user_place")
SLOTS_PER_CAKE = 6
STORAGE_SLOT_MIN = 1


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
    return normalize_storage_slot(int(m.group(1)))


def normalize_slot(slot: int) -> int:
    return int(slot) % SLOTS_PER_CAKE


def normalize_storage_slot(slot: int) -> int:
    slot = normalize_slot(slot)
    if SLOTS_PER_CAKE <= 1:
        return slot
    return STORAGE_SLOT_MIN if slot == 0 else slot


def next_slot(slot: int) -> int:
    return normalize_slot(slot + 1)


def prev_slot(slot: int) -> int:
    return normalize_slot(slot - 1)


def next_storage_slot(slot: int) -> int:
    nxt = next_slot(slot)
    if SLOTS_PER_CAKE <= 1:
        return nxt
    return STORAGE_SLOT_MIN if nxt == 0 else nxt


def storage_slots() -> list[int]:
    if SLOTS_PER_CAKE <= 1:
        return [0]
    return list(range(STORAGE_SLOT_MIN, SLOTS_PER_CAKE))


def must_user_active(db: Session, user_id: str) -> models.User:
    u = db.get(models.User, user_id)
    if not u:
        raise ValueError("invalid_user")
    if u.status == "banned" or u.status not in ALLOWED_USER_STATUSES:
        raise ValueError("invalid_user")
    return u


def _pending_cake_slot_state(db: Session, cake_id: str, slot_index: int) -> models.CakeSlotState | None:
    for obj in db.new:
        if isinstance(obj, models.CakeSlotState) and obj.cake_id == cake_id and int(obj.slot_index) == int(slot_index):
            return obj
    return None


def _pending_cake_state(db: Session, cake_id: str) -> models.CakeState | None:
    for obj in db.new:
        if isinstance(obj, models.CakeState) and obj.cake_id == cake_id:
            return obj
    return None


def _ensure_slot_state_seeded(db: Session, tool: models.ToolItem):
    slot_index = parse_slot_index(tool.slot_id)

    pending = _pending_cake_slot_state(db, tool.cake_id, slot_index)
    if pending is not None:
        # If pending row exists but has no tool assigned, fill it.
        if pending.tool_item_id is None:
            pending.tool_item_id = tool.tool_item_id
        return pending

    state = db.get(models.CakeSlotState, {"cake_id": tool.cake_id, "slot_index": slot_index})
    if state is None:
        state = models.CakeSlotState(
            cake_id=tool.cake_id,
            slot_index=slot_index,
            tool_item_id=tool.tool_item_id,
        )
        db.add(state)
        return state

    # Keep an existing empty slot seeded with the known legacy tool if needed.
    if state.tool_item_id is None:
        state.tool_item_id = tool.tool_item_id
    return state


def _ensure_cake_state_seeded(db: Session, cake_id: str):
    pending = _pending_cake_state(db, cake_id)
    if pending is not None:
        return pending

    row = db.get(models.CakeState, cake_id)
    if row is None:
        row = models.CakeState(cake_id=cake_id, current_slot=0)
        db.add(row)
        return row
    return row


def get_cake_current_slot(db: Session, cake_id: str) -> int:
    row = _ensure_cake_state_seeded(db, cake_id)
    db.flush()
    assert row is not None
    return int(row.current_slot)


def set_cake_current_slot(db: Session, cake_id: str, slot: int):
    row = _ensure_cake_state_seeded(db, cake_id)
    db.flush()
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
    rows = db.execute(
        select(models.CakeSlotState)
        .where(models.CakeSlotState.tool_item_id == tool_item_id)
        .order_by(models.CakeSlotState.slot_index.asc())
    ).scalars().all()
    if not rows:
        tool = db.get(models.ToolItem, tool_item_id)
        if not tool:
            raise ValueError("invalid_tool_item")
        return parse_slot_index(tool.slot_id)

    for row in rows:
        slot_index = int(row.slot_index)
        if slot_index != 0:
            return slot_index
    return normalize_storage_slot(int(rows[0].slot_index))


def _allocate_tool_item_for_model(
    db: Session,
    tool_model_id: str,
    *,
    reserved_tool_item_ids: set[str] | None = None,
) -> models.ToolItem | None:
    reserved_tool_item_ids = reserved_tool_item_ids or set()

    candidates = db.execute(
        select(models.ToolItem).where(
            models.ToolItem.tool_model_id == tool_model_id,
            models.ToolItem.is_active.is_(True),
        )
    ).scalars().all()

    preferred: list[tuple[int, models.ToolItem]] = []
    fallback: list[tuple[int, models.ToolItem]] = []
    for ti in candidates:
        if ti.tool_item_id in reserved_tool_item_ids:
            continue
        _ensure_slot_state_seeded(db, ti)
        _ensure_cake_state_seeded(db, ti.cake_id)
        if not _is_tool_item_available(db, ti.tool_item_id):
            continue
        current_cake_slot = get_cake_current_slot(db, ti.cake_id)
        target_slot = next_storage_slot(current_cake_slot)
        entry = (parse_cake_num(ti.cake_id), ti)
        if _current_slot_for_tool(db, ti.tool_item_id) == target_slot:
            preferred.append(entry)
        else:
            fallback.append(entry)

    if preferred:
        preferred.sort(key=lambda x: x[0])
        return preferred[0][1]
    if fallback:
        fallback.sort(key=lambda x: x[0])
        return fallback[0][1]
    return None


def _allocate_return_slot(db: Session, cake_id: str, *, reserved_slots: set[int] | None = None) -> int:
    reserved_slots = reserved_slots or set()

    occupied = {0}
    occupied.update(int(slot) for slot in reserved_slots if int(slot) != 0)
    occupied.update(
        int(row.slot_index)
        for row in db.execute(
            select(models.CakeSlotState).where(
                models.CakeSlotState.cake_id == cake_id,
                models.CakeSlotState.tool_item_id.is_not(None),
            )
        ).scalars().all()
        if int(row.slot_index) != 0
    )

    current = normalize_storage_slot(get_cake_current_slot(db, cake_id))
    if current not in occupied:
        return current

    for idx in storage_slots():
        if idx not in occupied:
            return idx

    raise ValueError(f"no_free_slot:{cake_id}")


def create_dispense_batch(db: Session, user_id: str, items: list[dict], loan_period_hours: int):
    user = must_user_active(db, user_id)
    if not items:
        raise ValueError("no_items")

    batch_id = models.new_id("batch")
    request_ids: list[str] = []
    reserved_tool_item_ids: set[str] = set()
    model_counts: dict[str, int] = {}
    idx = 0

    for item in items:
        tool_model_id = item.get("tool_model_id")
        qty = int(item.get("qty", 1))
        if not tool_model_id:
            raise ValueError("missing_tool_model_id")
        if qty <= 0:
            raise ValueError("invalid_qty")

        tm = db.get(models.ToolModel, tool_model_id)
        if not tm:
            raise ValueError(f"invalid_tool_model_id:{tool_model_id}")

        model_counts[tool_model_id] = model_counts.get(tool_model_id, 0) + qty
        if getattr(tm, "max_qty_per_user", None):
            already_out = db.execute(
                select(models.Loan).join(models.ToolItem, models.ToolItem.tool_item_id == models.Loan.tool_item_id).where(
                    models.Loan.user_id == user_id,
                    models.Loan.returned_at.is_(None),
                    models.Loan.status.in_(ACTIVE_LOAN_STATUSES),
                    models.ToolItem.tool_model_id == tool_model_id,
                )
            ).scalars().all()
            if len(already_out) + model_counts[tool_model_id] > int(tm.max_qty_per_user):
                raise ValueError(f"model_limit_exceeded:{tool_model_id}")

        if getattr(tm, "max_loan_hours", None) and int(loan_period_hours) > int(tm.max_loan_hours):
            raise ValueError(f"loan_period_exceeds_model_limit:{tool_model_id}")

    for item in items:
        tool_model_id = item.get("tool_model_id")
        qty = int(item.get("qty", 1))
        for _ in range(qty):
            ti = _allocate_tool_item_for_model(db, tool_model_id, reserved_tool_item_ids=reserved_tool_item_ids)
            if not ti:
                raise ValueError(f"not_enough_available_items:{tool_model_id}")

            reserved_tool_item_ids.add(ti.tool_item_id)
            idx += 1
            rid = f"{batch_id}_item_{idx}"
            request_ids.append(rid)
            target_slot = _current_slot_for_tool(db, ti.tool_item_id)
            db.add(models.LoanRequest(
                request_id=rid,
                batch_id=batch_id,
                request_type="dispense",
                user_id=user.user_id,
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
    reserved_tool_item_ids: set[str] = set()
    reserved_slots_by_cake: dict[str, set[int]] = {}

    for item in items:
        tool_item_id = item.get("tool_item_id")
        if not tool_item_id:
            raise ValueError("missing_tool_item_id")
        if tool_item_id in reserved_tool_item_ids:
            raise ValueError("duplicate_tool_item_id")

        loan = db.execute(
            select(models.Loan).where(
                models.Loan.user_id == user_id,
                models.Loan.tool_item_id == tool_item_id,
                models.Loan.returned_at.is_(None),
                models.Loan.status.in_(ACTIVE_LOAN_STATUSES),
            )
        ).scalar_one_or_none()
        if not loan:
            raise ValueError("invalid_loan")

        tool = db.get(models.ToolItem, tool_item_id)
        if not tool:
            raise ValueError("invalid_tool_item")

        reserved_tool_item_ids.add(tool_item_id)
        reserved_slots = reserved_slots_by_cake.setdefault(tool.cake_id, set())
        target_slot = _allocate_return_slot(db, tool.cake_id, reserved_slots=reserved_slots)
        reserved_slots.add(target_slot)

        idx += 1
        rid = f"{batch_id}_item_{idx}"
        request_ids.append(rid)
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
        slot_rows = db.execute(
            select(models.CakeSlotState).where(models.CakeSlotState.cake_id == cake.cake_id).order_by(models.CakeSlotState.slot_index.asc())
        ).scalars().all()
        slot_map = {int(s.slot_index): s.tool_item_id for s in slot_rows}
        slots = []
        for idx in range(SLOTS_PER_CAKE):
            slots.append({
                "slot_index": idx,
                "tool_item_id": None if idx == 0 else slot_map.get(idx),
                "is_storage_slot": idx != 0,
            })
        out.append({
            "cake_id": cake.cake_id,
            "current_slot": cake.current_slot,
            "slots": slots,
        })
    return out