from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime


# ---------------- MQTT / ADMIN TEST ----------------

class TOPIC_CMD_ADMIN_TEST(BaseModel):
    request_id: str
    motor_id: str
    action: str


# ---------------- RFID ----------------

class RfidSetModeReq(BaseModel):
    reader_id: str
    mode: Literal["card", "tool"]


class RfidWriteReq(BaseModel):
    reader_id: str
    text: str


class RfidWriteResp(BaseModel):
    ok: bool = True
    request_id: str


class RfidWriteStatus(BaseModel):
    request_id: str
    stage: str  # queued|succeeded|failed
    error: Optional[str] = None


class AssignCardReq(BaseModel):
    card_id: str


class AssignToolTagReq(BaseModel):
    tool_tag_id: str


class CardAuthRequest(BaseModel):
    card_id: str


class RfidCardScan(BaseModel):
    card_id: str
    reader_id: Optional[str] = None


# ---------------- USERS ----------------

UserRole = Literal["student", "staff", "admin"]
UserStatus = Literal["active", "good", "delinquent", "banned"]


class AdminUserCreate(BaseModel):
    """
    Admin creates user. Server generates user_id.
    """
    card_id: Optional[str] = None
    student_number: Optional[str] = None
    first_name: str
    last_name: str
    role: UserRole = "student"
    status: UserStatus = "active"


class AdminUserPatch(BaseModel):
    card_id: Optional[str] = None
    student_number: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[UserRole] = None
    status: Optional[UserStatus] = None


class UserOut(BaseModel):
    user_id: str
    card_id: Optional[str] = None
    student_number: Optional[str] = None
    first_name: str
    last_name: str
    role: str
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------- TOOL MODELS ----------------
# FUTURE POLICY:
# - max_loan_hours: cap how long a user can request for this model
# - max_qty_per_user: cap how many concurrent active loans of this model a user can have

class AdminToolModelCreate(BaseModel):
    """
    Server generates tool_model_id.
    """
    name: str
    description: str = ""
    category: Optional[str] = None

    # policy (optional now; enforce later in user_flow)
    max_loan_hours: Optional[int] = Field(default=None, ge=1, le=24 * 30)
    max_qty_per_user: Optional[int] = Field(default=None, ge=1, le=50)


class AdminToolModelPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None

    # policy (optional)
    max_loan_hours: Optional[int] = Field(default=None, ge=1, le=24 * 30)
    max_qty_per_user: Optional[int] = Field(default=None, ge=1, le=50)


class ToolModelOut(BaseModel):
    tool_model_id: str
    name: str
    description: str
    category: Optional[str] = None

    # policy (optional)
    max_loan_hours: Optional[int] = None
    max_qty_per_user: Optional[int] = None

    class Config:
        from_attributes = True


# ---------------- TOOL ITEMS ----------------

ToolCondition = Literal["ok", "worn", "damaged", "missing_parts"]


class AdminToolItemCreate(BaseModel):
    tool_item_id: Optional[str] = None   # server can generate
    tool_model_id: str
    tool_tag_id: str                     # REQUIRED (DB NOT NULL)
    cake_id: str
    slot_id: str
    condition_status: ToolCondition = "ok"
    is_active: bool = True


class AdminToolItemPatch(BaseModel):
    tool_model_id: Optional[str] = None
    tool_tag_id: Optional[str] = None
    cake_id: Optional[str] = None
    slot_id: Optional[str] = None
    condition_status: Optional[ToolCondition] = None
    is_active: Optional[bool] = None


class ToolItemOut(BaseModel):
    tool_item_id: str
    tool_model_id: str
    tool_tag_id: Optional[str] = None
    cake_id: str
    slot_id: str
    condition_status: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------------- LOANS ----------------

class LoanOut(BaseModel):
    loan_id: str
    user_id: str
    tool_item_id: str
    issued_at: datetime
    due_at: datetime
    confirmed_at: Optional[datetime] = None
    returned_at: Optional[datetime] = None
    status: str

    class Config:
        from_attributes = True


class AdminLoanPatch(BaseModel):
    due_at: Optional[datetime] = None
    returned_at: Optional[datetime] = None
    status: Optional[str] = None


class AdminExtendLoanReq(BaseModel):
    add_hours: int = Field(ge=1, le=24 * 30)


# ---------------- ADMIN MOTOR TEST ----------------

class AdminMotorTestReq(BaseModel):
    motor_id: int
    action: Literal["dispense", "return"]


class AdminMotorTestResp(BaseModel):
    ok: bool = True
    request_id: str
    motor_id: int
    action: Literal["dispense", "return"]


class AdminMotorTestStatus(BaseModel):
    request_id: str
    motor_id: int
    action: Literal["dispense", "return"]
    stage: Literal["queued", "accepted", "in_progress", "succeeded", "failed"]
    error_code: Optional[str] = None
    error_reason: Optional[str] = None


# ---------------- EVENTS ----------------

class EventOut(BaseModel):
    event_id: int
    ts: datetime
    event_type: str
    actor_type: str
    actor_id: Optional[str] = None
    request_id: Optional[str] = None
    tool_item_id: Optional[str] = None
    payload_json: str

    class Config:
        from_attributes = True


# ---------------- USER FLOW (dispense/return) ----------------

# Shopping-cart dispense item: backend allocates tool_item_id + slot_id
class DispenseItem(BaseModel):
    tool_model_id: str
    qty: int = Field(default=1, ge=1, le=10)


class DispenseBatchRequest(BaseModel):
    user_id: str
    items: List[DispenseItem]
    loan_period_hours: int = Field(default=24, ge=1, le=24 * 30)


class DispenseBatchResponse(BaseModel):
    batch_id: str
    request_ids: List[str]


class ToolConfirmRequest(BaseModel):
    user_id: str
    tool_tag_id: str
    reader_id: Optional[str] = None


# Return: user provides tool_item_id; backend finds active loan + slot_id
class ReturnItem(BaseModel):
    tool_item_id: str


class ReturnBatchRequest(BaseModel):
    user_id: str
    items: List[ReturnItem]


class ReturnBatchResponse(BaseModel):
    batch_id: str
    request_ids: List[str]
