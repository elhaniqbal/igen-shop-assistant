
import json

from .helpers import create_open_loan, create_loan_request


def test_handle_mqtt_message_logs_event_and_dispatches(seeded_db, backend_modules):
    create_loan_request(
        seeded_db,
        backend_modules.models,
        request_id="req_1",
        batch_id="batch_1",
        request_type="dispense",
        user_id="user_1",
        tool_item_id="tool_1",
        slot_id="1",
    )

    backend_modules.mqtt._handle_mqtt_message("igen/evt/dispense", {"request_id": "req_1", "stage": "accepted"})

    req = seeded_db.get(backend_modules.models.LoanRequest, "req_1")
    assert req.hw_status == "accepted"

    events = seeded_db.query(backend_modules.models.Event).filter_by(event_type="mqtt:igen/evt/dispense").all()
    assert len(events) == 1
    assert json.loads(events[0].payload_json)["stage"] == "accepted"


def test_dispense_success_creates_single_unconfirmed_loan(seeded_db, backend_modules):
    create_loan_request(
        seeded_db,
        backend_modules.models,
        request_id="req_2",
        batch_id="batch_2",
        request_type="dispense",
        user_id="user_1",
        tool_item_id="tool_1",
        slot_id="1",
    )

    payload = {"request_id": "req_2", "stage": "succeeded"}
    backend_modules.mqtt.handle_evt_dispense(seeded_db, payload)
    backend_modules.mqtt.handle_evt_dispense(seeded_db, payload)

    req = seeded_db.get(backend_modules.models.LoanRequest, "req_2")
    loans = seeded_db.query(backend_modules.models.Loan).filter_by(tool_item_id="tool_1").all()
    assert req.hw_status == "dispensed_ok"
    assert len(loans) == 1
    assert loans[0].status == "unconfirmed"


def test_dispense_failure_records_error(seeded_db, backend_modules):
    create_loan_request(
        seeded_db,
        backend_modules.models,
        request_id="req_fail",
        batch_id="batch_f",
        request_type="dispense",
        user_id="user_1",
        tool_item_id="tool_1",
        slot_id="1",
    )

    backend_modules.mqtt.handle_evt_dispense(
        seeded_db,
        {"request_id": "req_fail", "stage": "failed", "error_code": "JAM", "error_reason": "gantry jam"},
    )

    req = seeded_db.get(backend_modules.models.LoanRequest, "req_fail")
    assert req.hw_status == "failed"
    assert req.hw_error_code == "JAM"
    assert req.hw_error_reason == "gantry jam"


def test_return_success_marks_open_loan_returned(seeded_db, backend_modules):
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_ret", user_id="user_1", tool_item_id="tool_1", status="active")
    create_loan_request(
        seeded_db,
        backend_modules.models,
        request_id="ret_1",
        batch_id="retbatch_1",
        request_type="return",
        user_id="user_1",
        tool_item_id="tool_1",
        slot_id="1",
    )

    backend_modules.mqtt.handle_evt_return(seeded_db, {"request_id": "ret_1", "stage": "succeeded"})

    req = seeded_db.get(backend_modules.models.LoanRequest, "ret_1")
    loan = seeded_db.get(backend_modules.models.Loan, "loan_ret")
    assert req.hw_status == "return_ok"
    assert loan.status == "returned"
    assert loan.returned_at is not None


def test_return_failure_records_error(seeded_db, backend_modules):
    create_loan_request(
        seeded_db,
        backend_modules.models,
        request_id="ret_fail",
        batch_id="retbatch_2",
        request_type="return",
        user_id="user_1",
        tool_item_id="tool_1",
        slot_id="1",
    )

    backend_modules.mqtt.handle_evt_return(
        seeded_db,
        {"request_id": "ret_fail", "stage": "failed", "error_code": "BUSY", "error_reason": "machine busy"},
    )

    req = seeded_db.get(backend_modules.models.LoanRequest, "ret_fail")
    assert req.hw_status == "failed"
    assert req.hw_error_code == "BUSY"
