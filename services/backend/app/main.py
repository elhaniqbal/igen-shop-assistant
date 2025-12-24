from contextlib import asynccontextmanager
from fastapi import FastAPI

from .db import init_db
from .mqtt import MqttBus

from .routers.health import router as health_router
from .routers.user import router as user_router
from .routers.rfid import router as rfid_router
from .routers.admin import router as admin_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        from .db_migrations import ensure_tool_model_policy_columns
        ensure_tool_model_policy_columns()
    except Exception as e:
        print(f"[MIGRATIONS] failed: {e!r}")

    app.state.mqtt = MqttBus()
    app.state.mqtt.start()

    try:
        yield
    finally:
        app.state.mqtt.stop()

app = FastAPI(title="IGEN Shop Assistant API", lifespan=lifespan)

# All routers mounted here
app.include_router(health_router, prefix="/api")
app.include_router(user_router, prefix="/api")
app.include_router(rfid_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
