from __future__ import annotations

import json
from types import SimpleNamespace



def test_on_connect_subscribes_to_all_command_topics(make_bridge):
    built = make_bridge(mode="SIM")

    built.bridge._on_connect(built.mqtt, None, None, 0)

    topics = {t for t, _ in built.mqtt.subscriptions}
    assert built.mod.TOPIC_CMD_DISPENSE in topics
    assert built.mod.TOPIC_CMD_RETURN in topics
    assert built.mod.TOPIC_CMD_ADMIN_MANUAL in topics
    assert built.mod.TOPIC_CMD_ADMIN_MACHINE in topics
    assert built.mod.TOPIC_CMD_ADMIN_CAL in topics



def test_sim_admin_machine_handler_publishes_status(monkeypatch, make_bridge, published_topics):
    built = make_bridge(mode="SIM")
    monkeypatch.setattr(built.mod, "SIM_ACK_DELAY_S", 0)
    monkeypatch.setattr(built.mod, "SIM_MIN_TIME_S", 0)
    monkeypatch.setattr(built.mod, "SIM_MAX_TIME_S", 0)
    monkeypatch.setattr(built.mod, "SIM_FAIL_RATE", 0)

    built.mod.handle_admin_machine(built.bridge, {"request_id": "sim-mach-1", "action": "query_status"})

    status_payloads = published_topics(built.mqtt, built.mod.TOPIC_EVT_MACHINE_STATUS)
    assert status_payloads[-1]["simulated"] is True



def test_dedup_prevents_same_request_id_running_twice(monkeypatch, make_bridge, published_topics):
    built = make_bridge(mode="SIM")
    monkeypatch.setattr(built.mod, "SIM_ACK_DELAY_S", 0)
    monkeypatch.setattr(built.mod, "SIM_MIN_TIME_S", 0)
    monkeypatch.setattr(built.mod, "SIM_MAX_TIME_S", 0)
    monkeypatch.setattr(built.mod, "SIM_FAIL_RATE", 0)

    payload = {"request_id": "dup-1", "cake_id": 1, "rotation_steps_60": 0}
    built.mod.handle_dispense(built.bridge, payload)
    built.mod.handle_dispense(built.bridge, payload)

    events = published_topics(built.mqtt, built.mod.TOPIC_EVT_DISPENSE)
    # one accepted event from the first simulated run only
    assert sum(1 for e in events if e["stage"] == "accepted") == 1



def test_on_message_dispatches_json_payload_to_handler(make_bridge, monkeypatch):
    built = make_bridge(mode="SIM")
    called = []

    def fake_handler(self, payload):
        called.append(payload)

    monkeypatch.setitem(built.mod.Bridge2.CMD_HANDLERS, built.mod.TOPIC_CMD_ADMIN_CAL, fake_handler)

    msg = SimpleNamespace(
        topic=built.mod.TOPIC_CMD_ADMIN_CAL,
        payload=json.dumps({"request_id": "m1", "action": "set_variable"}).encode("utf-8"),
        retain=False,
    )
    built.bridge._on_message(built.mqtt, None, msg)

    assert called == [{"request_id": "m1", "action": "set_variable"}]
