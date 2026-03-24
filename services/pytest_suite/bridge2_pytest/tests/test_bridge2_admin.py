from __future__ import annotations

from conftest import FakeEncoder


def test_admin_manual_move_cake_emits_warning_alert(make_bridge, published_topics):
    built = make_bridge()

    built.bridge._execute_admin_manual(
        {"request_id": "adm-1", "action": "move_cake", "cake_id": 1, "direction": "cw", "steps_60": 2}
    )

    assert built.moonraker.sent_gcodes == [
        "MOVE_CAKE_CW_60 CAKE=1",
        "MOVE_CAKE_CW_60 CAKE=1",
    ]
    events = published_topics(built.mqtt, built.mod.TOPIC_EVT_ADMIN_MANUAL)
    assert [e["stage"] for e in events] == ["accepted", "succeeded"]
    alerts = published_topics(built.mqtt, built.mod.TOPIC_EVT_MACHINE_ALERT)
    assert alerts[-1]["code"] == "CAKE_MOVED_MANUALLY"
    assert alerts[-1]["severity"] == "warning"



def test_admin_manual_set_cake_zero_uses_encoder_and_macro(make_bridge, published_topics):
    encoder = FakeEncoder()
    built = make_bridge(encoder=encoder)

    built.bridge._execute_admin_manual({"request_id": "adm-zero", "action": "set_cake_zero", "cake_id": 4})

    assert encoder.zero_calls == [4]
    assert built.moonraker.sent_gcodes == ["SA_CAKE_SET_ZERO CAKE=4"]
    alerts = published_topics(built.mqtt, built.mod.TOPIC_EVT_MACHINE_ALERT)
    assert alerts[-1]["code"] == "CAKE_ZERO_SET"



def test_admin_manual_bad_jog_fails(make_bridge, published_topics):
    built = make_bridge()

    built.bridge._execute_admin_manual(
        {"request_id": "adm-bad-jog", "action": "jog_axis", "axis": "horizontal", "direction": "up", "distance": 10}
    )

    events = published_topics(built.mqtt, built.mod.TOPIC_EVT_ADMIN_MANUAL)
    assert events[-1]["stage"] == "failed"
    assert events[-1]["error_code"] == "BAD_PAYLOAD"



def test_admin_machine_query_status_publishes_machine_status(make_bridge, published_topics):
    encoder = FakeEncoder()
    built = make_bridge(encoder=encoder)

    built.bridge._execute_admin_machine({"request_id": "mach-status", "action": "query_status"})

    events = published_topics(built.mqtt, built.mod.TOPIC_EVT_ADMIN_MACHINE)
    assert [e["stage"] for e in events] == ["accepted", "succeeded"]
    status_payloads = published_topics(built.mqtt, built.mod.TOPIC_EVT_MACHINE_STATUS)
    assert status_payloads[-1]["reachable"] is True
    assert status_payloads[-1]["encoder_status"] == "OK STATUS"



def test_admin_machine_restart_and_emergency_emit_alerts(make_bridge, published_topics):
    built = make_bridge()

    built.bridge._execute_admin_machine({"request_id": "mach-r1", "action": "restart_klipper"})
    built.bridge._execute_admin_machine({"request_id": "mach-e1", "action": "emergency_stop"})

    assert built.moonraker.restart_calls == ["klipper"]
    assert built.moonraker.emergency_stop_calls == 1
    alerts = published_topics(built.mqtt, built.mod.TOPIC_EVT_MACHINE_ALERT)
    codes = [a["code"] for a in alerts]
    assert "KLIPPER_RESTART_SENT" in codes
    assert "EMERGENCY_STOP_TRIGGERED" in codes



def test_admin_calibration_encoder_set_zero_and_clear_zero(make_bridge, published_topics):
    encoder = FakeEncoder()
    built = make_bridge(encoder=encoder)

    built.bridge._execute_admin_cal(
        {"request_id": "cal-sz", "action": "encoder_set_zero", "cake_id": 2, "deg": 33.5}
    )
    built.bridge._execute_admin_cal(
        {"request_id": "cal-cz", "action": "encoder_clear_zero", "cake_id": 2}
    )

    assert encoder.set_zero_calls == [(2, 33.5)]
    assert encoder.clear_zero_calls == [2]
    events = published_topics(built.mqtt, built.mod.TOPIC_EVT_ADMIN_CAL)
    assert events[-1]["stage"] == "succeeded"



def test_admin_calibration_set_variable_sends_save_variable(make_bridge):
    built = make_bridge()

    built.bridge._execute_admin_cal(
        {"request_id": "cal-var", "action": "set_variable", "variable": "door_x", "value": 123.4}
    )

    assert built.moonraker.sent_gcodes == ["SAVE_VARIABLE VARIABLE=door_x VALUE=123.4"]
