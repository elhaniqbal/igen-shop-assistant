from pydantic import BaseModel, Field
from typing import List, Literal, Optional
import uuid

class Student(BaseModel):
    ubc_card_uid: str
    student_id: str

class DispenseItem(BaseModel):
    tool_id: str
    qty: int = 1
    slot_id: str

class DispenseRequest(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    student: Student
    items: List[DispenseItem]
    loan_days: int = 7
    limit_policy: dict = {"max_tools": 3}

class DispenseDetail(BaseModel):
    slot_id: str
    result: Literal["OK", "JAM", "EMPTY", "DENIED", "ERROR"]

class DispenseResult(BaseModel):
    request_id: str
    status: Literal["OK", "DENIED", "PARTIAL", "ERROR"]
    details: List[DispenseDetail]