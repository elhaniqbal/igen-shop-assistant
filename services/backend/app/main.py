from contextlib import asynccontextmanager
from fastapi import FastAPI

from .db import init_db
from .mqtt import MqttBus
from .services.alert_service import AlertService

from .routers.health import router as health_router
from .routers.user import router as user_router
from .routers.rfid import router as rfid_router
from .routers.admin import router as admin_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()

    app.state.mqtt = MqttBus()
    app.state.mqtt.start()

    app.state.alert_service = AlertService()
    app.state.alert_service.start()

    try:
        yield
    finally:
        try:
            app.state.alert_service.stop()
        except Exception:
            pass
        app.state.mqtt.stop()


app = FastAPI(title="IGEN Shop Assistant API", lifespan=lifespan)
app.include_router(health_router, prefix="/api")
app.include_router(user_router, prefix="/api")
app.include_router(rfid_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
