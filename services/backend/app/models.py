from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from .db import Base

def utcnow():
    return datetime.now()

class User(Base):
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    card_id: Mapped[str | None] = mapped_column(String, unique=True, index=True, nullable=True)
    student_number: Mapped[str | None] = mapped_column(String, nullable=True)
    first_name: Mapped[str] = mapped_column(String, default="")
    last_name: Mapped[str] = mapped_column(String, default="")
    role: Mapped[str] = mapped_column(String, default="student")   # student|staff|admin
    status: Mapped[str] = mapped_column(String, default="good")  # good | delinquent | banned | whatever
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

class ToolModel(Base):
    __tablename__ = "tool_models"

    tool_model_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str | None] = mapped_column(String, nullable=True)

class ToolItem(Base):
    __tablename__ = "tool_items"

    tool_item_id: Mapped[str] = mapped_column(String, primary_key=True)
    tool_model_id: Mapped[str] = mapped_column(ForeignKey("tool_models.tool_model_id"), index=True)
    tool_tag_id: Mapped[str] = mapped_column(String, unique=True, index=True)  # NFC/RFID on tool
    cake_id: Mapped[str] = mapped_column(String, index=True)   # e.g. "cake_1"
    slot_id: Mapped[str] = mapped_column(String, index=True)  # e.g. "wheel_01_slot_05"
    condition_status: Mapped[str] = mapped_column(String, default="ok")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    model = relationship("ToolModel")

class LoanRequest(Base):
    __tablename__ = "loan_requests"

    request_id: Mapped[str] = mapped_column(String, primary_key=True)
    batch_id: Mapped[str] = mapped_column(String, index=True)
    request_type: Mapped[str] = mapped_column(String)  # dispense|return|admin

    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), index=True)
    tool_item_id: Mapped[str] = mapped_column(ForeignKey("tool_items.tool_item_id"), index=True)
    slot_id: Mapped[str] = mapped_column(String)
    loan_period_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)

    hw_status: Mapped[str] = mapped_column(String, default="pending")
    hw_error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    hw_error_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    hw_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

class Loan(Base):
    __tablename__ = "loans"

    loan_id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), index=True)
    tool_item_id: Mapped[str] = mapped_column(ForeignKey("tool_items.tool_item_id"), index=True)

    issued_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    due_at: Mapped[datetime] = mapped_column(DateTime)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String, default="active")  # active|overdue|returned|lost|damaged

class Event(Base):
    __tablename__ = "events"

    event_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    event_type: Mapped[str] = mapped_column(String, index=True)
    actor_type: Mapped[str] = mapped_column(String, default="system")  # user|system
    actor_id: Mapped[str | None] = mapped_column(String, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    tool_item_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
