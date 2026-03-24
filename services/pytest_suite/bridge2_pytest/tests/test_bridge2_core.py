from __future__ import annotations

from conftest import FakeEncoder


def test_normalize_delta_deg_wraps_expected_values(bridge2_mod):
    assert bridge2_mod.normalize_delta_deg(190) == -170
    assert bridge2_mod.normalize_delta_deg(-190) == 170
    assert bridge2_mod.normalize_delta_deg(60) == 60
    assert bridge2_mod.normalize_delta_deg(-60) == -60



def test_dispense_executes_expected_macro_sequence(make_bridge, published_topics):
    built = make_bridge()
    payload = {
        "request_id": "req-d1",
        "cake_id": 2,
        "rotation_steps_60": 2,
        "rotation_direction": "CW",
    }

    built.bridge._execute_request("dispense", payload)

    assert built.moonraker.sent_gcodes == [
        "SA_MOVE_TO_CAKE CAKE=2",
        "MOVE_CAKE_CW_60 CAKE=2",
        "MOVE_CAKE_CW_60 CAKE=2",
        "SA_MOVE_TO_DOOR",
    ]
    stages = published_topics(built.mqtt, built.mod.TOPIC_EVT_DISPENSE)
    assert [s["stage"] for s in stages] == ["accepted", "in_progress", "succeeded"]



def test_return_executes_expected_macro_sequence(make_bridge, published_topics):
    built = make_bridge()
    payload = {
        "request_id": "req-r1",
        "cake_id": 4,
        "rotation_steps_60": 1,
        "rotation_direction": "CCW",
    }

    built.bridge._execute_request("return", payload)

    assert built.moonraker.sent_gcodes == [
        "SA_MOVE_TO_DOOR",
        "SA_MOVE_TO_CAKE CAKE=4",
        "MOVE_CAKE_CCW_60 CAKE=4",
    ]
    stages = published_topics(built.mqtt, built.mod.TOPIC_EVT_RETURN)
    assert [s["stage"] for s in stages] == ["accepted", "in_progress", "succeeded"]



def test_negative_rotation_steps_flip_direction(make_bridge):
    built = make_bridge()
    payload = {
        "request_id": "req-neg",
        "cake_id": 1,
        "rotation_steps_60": -2,
        "rotation_direction": "CW",
    }

    built.bridge._execute_request("dispense", payload)

    assert built.moonraker.sent_gcodes[1:3] == [
        "MOVE_CAKE_CCW_60 CAKE=1",
        "MOVE_CAKE_CCW_60 CAKE=1",
    ]



def test_busy_machine_rejects_second_request(make_bridge, published_topics):
    built = make_bridge()
    built.bridge._active = built.mod.InFlight("other", "dispense", 0.0, {})

    built.bridge._execute_request("dispense", {"request_id": "req-busy", "cake_id": 1, "rotation_steps_60": 0})

    events = published_topics(built.mqtt, built.mod.TOPIC_EVT_DISPENSE)
    assert events[-1]["stage"] == "failed"
    assert events[-1]["error_code"] == "BUSY"
    assert built.moonraker.sent_gcodes == []



def test_unhomed_machine_fails_and_emits_alert(make_bridge, published_topics):
    built = make_bridge()
    built.moonraker.status_payload["result"]["status"]["toolhead"]["homed_axes"] = "xy"

    built.bridge._execute_request("dispense", {"request_id": "req-unhomed", "cake_id": 1, "rotation_steps_60": 0})

    events = published_topics(built.mqtt, built.mod.TOPIC_EVT_DISPENSE)
    assert events[-1]["stage"] == "failed"
    assert events[-1]["error_code"] == "MACHINE_UNHOMED"

    alerts = published_topics(built.mqtt, built.mod.TOPIC_EVT_MACHINE_ALERT)
    assert alerts[-1]["code"] == "MACHINE_UNHOMED"



def test_encoder_confirmed_rotation_reads_before_and_after(make_bridge):
    encoder = FakeEncoder(reads=[10.0, 70.0])
    built = make_bridge(encoder=encoder, encoder_confirm=True)

    built.bridge._execute_rotation("req-enc", cake_id=3, direction="CW")

    assert encoder.read_calls == [3, 3]
    assert built.moonraker.sent_gcodes == ["MOVE_CAKE_CW_60 CAKE=3"]



def test_encoder_mismatch_fails_request_and_emits_alert(make_bridge, published_topics):
    encoder = FakeEncoder(reads=[15.0, 30.0])
    built = make_bridge(encoder=encoder, encoder_confirm=True)

    built.bridge._execute_request("dispense", {"request_id": "req-enc-bad", "cake_id": 2, "rotation_steps_60": 1})

    events = published_topics(built.mqtt, built.mod.TOPIC_EVT_DISPENSE)
    assert events[-1]["stage"] == "failed"
    assert events[-1]["error_code"] == "ENCODER_MISMATCH"

    alerts = published_topics(built.mqtt, built.mod.TOPIC_EVT_MACHINE_ALERT)
    assert alerts[-1]["code"] == "ENCODER_MISMATCH"
