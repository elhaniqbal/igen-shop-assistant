from fastapi import Request
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..mqtt import MqttBus

def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_mqtt(req: Request) -> MqttBus:
    return req.app.state.mqtt
