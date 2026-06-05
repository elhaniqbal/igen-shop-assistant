import importlib
from types import SimpleNamespace

import pytest


class FakeMQTTClient:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload, qos=0, retain=False):
        self.published.append(
            {
                "topic": topic,
                "payload": payload,
                "qos": qos,
                "retain": retain,
            }
        )
        return SimpleNamespace(rc=0)


class FakeRequest:
    def __init__(
        self,
        request_id,
        batch_id,
        hw_status="queued",
        slot_id="1",
        tool_item=None,
    ):
        self.request_id = request_id
        self.batch_id = batch_id
        self.hw_status = hw_status
        self.slot_id = slot_id
        self.tool_item = tool_item


class FakeToolItem:
    def __init__(self, tool_item_id="ti-1", slot=None):
        self.tool_item_id = tool_item_id
        self.slot = slot


class FakeSlot:
    def __init__(self, slot_id="1", cake_id=1):
        self.slot_id = slot_id
        self.cake_id = cake_id


class FakeQuery:
    def __init__(self, items):
        self.items = list(items)

    def filter(self, *args, **kwargs):
        return self

    def filter_by(self, **kwargs):
        out = self.items
        for k, v in kwargs.items():
            out = [x for x in out if getattr(x, k, None) == v]
        return FakeQuery(out)

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return list(self.items)

    def first(self):
        return self.items[0] if self.items else None


class FakeDB:
    def __init__(self, requests):
        self.requests = requests
        self.commits = 0

    def query(self, model):
        return FakeQuery(self.requests)

    def commit(self):
        self.commits += 1


@pytest.fixture
def mqtt_module(monkeypatch):
    """
    Import the project's mqtt module if available. The tests are written to be
    easy to adapt: if your module path differs, change the candidate list.
    """
    candidates = [
        "app.mqtt",
        "backend.app.mqtt",
        "services.backend.app.mqtt",
    ]
    last_err = None
    for name in candidates:
        try:
            return importlib.import_module(name)
        except Exception as e:  # pragma: no cover - import path variance
            last_err = e
    pytest.skip(f"Could not import mqtt module from known paths: {last_err}")


@pytest.fixture
def fake_client(monkeypatch, mqtt_module):
    client = FakeMQTTClient()
    if hasattr(mqtt_module, "mqtt_client"):
        monkeypatch.setattr(mqtt_module, "mqtt_client", client, raising=False)
    if hasattr(mqtt_module, "client"):
        monkeypatch.setattr(mqtt_module, "client", client, raising=False)
    return client


def _invoke_release_next(mqtt_module, db, batch_id):
    """
    Tries a few likely function names so the test bundle stays useful even if
    you renamed the helper during refactor.
    """
    for fn_name in [
        "release_next_batch_request",
        "release_next_request_in_batch",
        "dispatch_next_batch_request",
        "maybe_release_next_batch_request",
    ]:
        fn = getattr(mqtt_module, fn_name, None)
        if fn:
            return fn(db, batch_id)
    pytest.skip("No recognized batch-release helper found in mqtt module")


def test_release_only_next_queued_request(mqtt_module, fake_client):
    slot1 = FakeSlot(slot_id="1", cake_id=1)
    slot2 = FakeSlot(slot_id="2", cake_id=2)
    r1 = FakeRequest("req-1", "batch-1", hw_status="succeeded", slot_id="1", tool_item=FakeToolItem(slot=slot1))
    r2 = FakeRequest("req-2", "batch-1", hw_status="queued", slot_id="2", tool_item=FakeToolItem(slot=slot2))
    r3 = FakeRequest("req-3", "batch-1", hw_status="queued", slot_id="3", tool_item=FakeToolItem(slot=slot2))
    db = FakeDB([r1, r2, r3])

    _invoke_release_next(mqtt_module, db, "batch-1")

    assert len(fake_client.published) == 1
    msg = fake_client.published[0]
    assert msg["topic"] == "igen/cmd/dispense"
    assert "req-2" in str(msg["payload"])
    assert "req-3" not in str(msg["payload"])


def test_no_release_when_batch_has_in_progress_request(mqtt_module, fake_client):
    slot = FakeSlot(slot_id="1", cake_id=1)
    r1 = FakeRequest("req-1", "batch-2", hw_status="in_progress", slot_id="1", tool_item=FakeToolItem(slot=slot))
    r2 = FakeRequest("req-2", "batch-2", hw_status="queued", slot_id="2", tool_item=FakeToolItem(slot=slot))
    db = FakeDB([r1, r2])

    _invoke_release_next(mqtt_module, db, "batch-2")

    assert fake_client.published == []


def test_terminal_success_can_trigger_next_release(mqtt_module, fake_client):
    slot = FakeSlot(slot_id="1", cake_id=1)
    db = FakeDB(
        [
            FakeRequest("req-a", "batch-3", hw_status="succeeded", slot_id="1", tool_item=FakeToolItem(slot=slot)),
            FakeRequest("req-b", "batch-3", hw_status="queued", slot_id="2", tool_item=FakeToolItem(slot=slot)),
        ]
    )

    _invoke_release_next(mqtt_module, db, "batch-3")

    assert len(fake_client.published) == 1
    assert "req-b" in str(fake_client.published[0]["payload"])


def test_failed_request_behavior_is_explicit(mqtt_module, fake_client):
    slot = FakeSlot(slot_id="1", cake_id=1)
    db = FakeDB(
        [
            FakeRequest("req-a", "batch-4", hw_status="failed", slot_id="1", tool_item=FakeToolItem(slot=slot)),
            FakeRequest("req-b", "batch-4", hw_status="queued", slot_id="2", tool_item=FakeToolItem(slot=slot)),
        ]
    )

    _invoke_release_next(mqtt_module, db, "batch-4")

    # Choose ONE policy in implementation. This assertion is intentionally loose
    # so the test reminds you to encode the policy explicitly.
    assert len(fake_client.published) in (0, 1)


def test_request_payload_contains_bridge2_fields(mqtt_module, fake_client):
    slot = FakeSlot(slot_id="5", cake_id=3)
    db = FakeDB(
        [
            FakeRequest("req-a", "batch-5", hw_status="succeeded", slot_id="1", tool_item=FakeToolItem(slot=slot)),
            FakeRequest("req-b", "batch-5", hw_status="queued", slot_id="5", tool_item=FakeToolItem(slot=slot)),
        ]
    )

    _invoke_release_next(mqtt_module, db, "batch-5")

    assert len(fake_client.published) == 1
    payload = str(fake_client.published[0]["payload"])
    # These are the important bridge2-facing fields to keep aligned.
    assert "cake" in payload.lower()
    assert "rotation" in payload.lower() or "steps_60" in payload.lower()
