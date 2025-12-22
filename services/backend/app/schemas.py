from pydantic import BaseModel
from typing import Optional, List, Literal
from datetime import datetime
class TOPIC_CMD_ADMIN_TEST(BaseModel):
    request_id: str
    motor_id: str
    action: str


# ---------- RFID -----------

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


# ---------- USERS ----------
class AdminUserCreate(BaseModel):
    user_id: str
    card_id: Optional[str] = None
    student_number: Optional[str] = None
    first_name: str = ""
    last_name: str = ""
    role: str = "student"     # student|staff|admin
    status: str = "good"      # good|delinquent|banned|...

class AdminUserPatch(BaseModel):
    card_id: Optional[str] = None
    student_number: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None

class UserOut(BaseModel):
    user_id: str
    card_id: Optional[str]
    student_number: Optional[str]
    first_name: str
    last_name: str
    role: str
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------- TOOL MODELS ----------
class AdminToolModelCreate(BaseModel):
    tool_model_id: str
    name: str
    description: str = ""
    category: Optional[str] = None

class AdminToolModelPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None

class ToolModelOut(BaseModel):
    tool_model_id: str
    name: str
    description: str
    category: Optional[str]

    class Config:
        from_attributes = True


# ---------- TOOL ITEMS ----------
class AdminToolItemCreate(BaseModel):
    tool_item_id: str
    tool_model_id: str
    tool_tag_id: str
    cake_id: str
    slot_id: str
    condition_status: str = "ok"
    is_active: bool = True

class AdminToolItemPatch(BaseModel):
    tool_model_id: Optional[str] = None
    tool_tag_id: Optional[str] = None
    cake_id: Optional[str] = None
    slot_id: Optional[str] = None
    condition_status: Optional[str] = None
    is_active: Optional[bool] = None

class ToolItemOut(BaseModel):
    tool_item_id: str
    tool_model_id: str
    tool_tag_id: str
    cake_id: str
    slot_id: str
    condition_status: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ---------- LOANS ----------
class LoanOut(BaseModel):
    loan_id: str
    user_id: str
    tool_item_id: str
    issued_at: datetime
    due_at: datetime
    confirmed_at: Optional[datetime]
    returned_at: Optional[datetime]
    status: str

    class Config:
        from_attributes = True

class AdminLoanPatch(BaseModel):
    due_at: Optional[datetime] = None
    returned_at: Optional[datetime] = None
    status: Optional[str] = None



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



# ---------- EVENTS ----------
class EventOut(BaseModel):
    event_id: int
    ts: datetime
    event_type: str
    actor_type: str
    actor_id: Optional[str]
    request_id: Optional[str]
    tool_item_id: Optional[str]
    payload_json: str

    class Config:
        from_attributes = True


class DispenseItem(BaseModel):
    tool_item_id: str
    slot_id: str
    qty: int = 1

class DispenseBatchRequest(BaseModel):
    user_id: str
    items: List[DispenseItem]
    loan_period_hours: int = 24

class DispenseBatchResponse(BaseModel):
    batch_id: str
    request_ids: List[str]

class ToolConfirmRequest(BaseModel):
    user_id: str
    tool_tag_id: str
    reader_id: str | None = None

class ReturnItem(BaseModel):
    loan_id: str
    tool_item_id: str
    slot_id: str

class ReturnBatchRequest(BaseModel):
    user_id: str
    items: List[ReturnItem]

class ReturnBatchResponse(BaseModel):
    batch_id: str
    request_ids: List[str]

class RfidCardScan(BaseModel):
    card_id: str
    reader_id: Optional[str] = None