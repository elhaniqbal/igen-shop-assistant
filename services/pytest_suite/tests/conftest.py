
import importlib
import os
import sys
import types
from pathlib import Path

import pytest


def _purge_app_modules():
    for name in list(sys.modules):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]


class FakeMqttBus:
    def __init__(self):
        self.published = []
        self.started = False
        self.stopped = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def publish(self, topic, payload, qos=1):
        self.published.append({"topic": topic, "payload": payload, "qos": qos})


@pytest.fixture()
def backend_modules(tmp_path, monkeypatch):
    backend_root = Path(__file__).resolve().parents[1]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("MQTT_HOST", "test-mqtt")
    monkeypatch.setenv("MQTT_PORT", "1883")

    fake_mfrc = types.ModuleType("mfrc522")
    fake_mfrc.SimpleMFRC522 = object
    sys.modules.setdefault("mfrc522", fake_mfrc)

    _purge_app_modules()

    db = importlib.import_module("app.db")
    models = importlib.import_module("app.models")
    mqtt = importlib.import_module("app.mqtt")
    user_flow = importlib.import_module("app.usecases.user_flow")
    admin_crud = importlib.import_module("app.usecases.admin_crud")
    deps = importlib.import_module("app.routers.deps")
    main = importlib.import_module("app.main")
    bridge = importlib.import_module("app.bridge")

    db.init_db()

    return types.SimpleNamespace(
        db=db,
        models=models,
        mqtt=mqtt,
        user_flow=user_flow,
        admin_crud=admin_crud,
        deps=deps,
        main=main,
        bridge=bridge,
    )


@pytest.fixture()
def db_session(backend_modules):
    session = backend_modules.db.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def seeded_db(db_session, backend_modules):
    models = backend_modules.models

    user = models.User(
        user_id="user_1",
        card_id="CARD-1",
        first_name="Elhan",
        last_name="Iqbal",
        role="student",
        status="good",
    )
    banned = models.User(
        user_id="user_banned",
        card_id="CARD-BANNED",
        first_name="Bad",
        last_name="Actor",
        role="student",
        status="banned",
    )
    model = models.ToolModel(
        tool_model_id="tm_hex",
        name="Hex Key",
        description="Allen key",
        category="Hand Tools",
    )
    item1 = models.ToolItem(
        tool_item_id="tool_1",
        tool_model_id="tm_hex",
        tool_tag_id="TAG-1",
        cake_id="cake_1",
        slot_id="1",
        condition_status="ok",
        is_active=True,
    )
    item2 = models.ToolItem(
        tool_item_id="tool_2",
        tool_model_id="tm_hex",
        tool_tag_id="TAG-2",
        cake_id="cake_1",
        slot_id="2",
        condition_status="ok",
        is_active=True,
    )
    other_model = models.ToolModel(
        tool_model_id="tm_pliers",
        name="Pliers",
        description="Needle nose",
        category="Hand Tools",
    )
    other_item = models.ToolItem(
        tool_item_id="tool_3",
        tool_model_id="tm_pliers",
        tool_tag_id="TAG-3",
        cake_id="cake_2",
        slot_id="3",
        condition_status="ok",
        is_active=True,
    )

    db_session.add_all([user, banned, model, item1, item2, other_model, other_item])
    db_session.commit()
    return db_session


@pytest.fixture()
def client(backend_modules, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(backend_modules.mqtt.MqttBus, "start", lambda self: None)
    monkeypatch.setattr(backend_modules.mqtt.MqttBus, "stop", lambda self: None)

    fake_bus = FakeMqttBus()
    backend_modules.main.app.state.mqtt = fake_bus
    with TestClient(backend_modules.main.app) as test_client:
        test_client.app.state.mqtt = fake_bus
        yield test_client
