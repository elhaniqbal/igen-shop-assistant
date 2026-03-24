
import pytest

from .helpers import create_open_loan, create_loan_request


def test_create_dispense_batch_allocates_available_items(seeded_db, backend_modules):
    out = backend_modules.user_flow.create_dispense_batch(
        seeded_db,
        user_id="user_1",
        items=[{"tool_model_id": "tm_hex", "qty": 2}],
        loan_period_hours=48,
    )

    assert out["batch_id"].startswith("batch_")
    assert len(out["request_ids"]) == 2

    rows = seeded_db.query(backend_modules.models.LoanRequest).order_by(backend_modules.models.LoanRequest.request_id).all()
    assert [r.tool_item_id for r in rows] == ["tool_1", "tool_2"]
    assert all(r.hw_status == "pending" for r in rows)
    assert all(r.loan_period_hours == 48 for r in rows)


def test_create_dispense_batch_rejects_banned_user(seeded_db, backend_modules):
    with pytest.raises(ValueError, match="user_banned"):
        backend_modules.user_flow.create_dispense_batch(
            seeded_db,
            user_id="user_banned",
            items=[{"tool_model_id": "tm_hex", "qty": 1}],
            loan_period_hours=24,
        )


def test_create_dispense_batch_respects_open_loan_and_inflight_reservation(seeded_db, backend_modules):
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_1", user_id="user_1", tool_item_id="tool_1")
    create_loan_request(
        seeded_db,
        backend_modules.models,
        request_id="req_reserved",
        batch_id="batch_existing",
        request_type="dispense",
        user_id="user_1",
        tool_item_id="tool_2",
        slot_id="2",
        hw_status="accepted",
    )

    with pytest.raises(ValueError, match="not_enough_available_items:tm_hex"):
        backend_modules.user_flow.create_dispense_batch(
            seeded_db,
            user_id="user_1",
            items=[{"tool_model_id": "tm_hex", "qty": 1}],
            loan_period_hours=24,
        )


def test_create_return_batch_requires_open_loan(seeded_db, backend_modules):
    with pytest.raises(ValueError, match="invalid_loan"):
        backend_modules.user_flow.create_return_batch(
            seeded_db,
            user_id="user_1",
            items=[{"tool_item_id": "tool_1"}],
        )


def test_create_return_batch_builds_requests_for_active_and_unconfirmed_loans(seeded_db, backend_modules):
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_1", user_id="user_1", tool_item_id="tool_1", status="unconfirmed")
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_2", user_id="user_1", tool_item_id="tool_3", status="active")

    out = backend_modules.user_flow.create_return_batch(
        seeded_db,
        user_id="user_1",
        items=[{"tool_item_id": "tool_1"}, {"tool_item_id": "tool_3"}],
    )

    assert out["batch_id"].startswith("retbatch_")
    assert len(out["request_ids"]) == 2
    rows = seeded_db.query(backend_modules.models.LoanRequest).filter_by(request_type="return").order_by(backend_modules.models.LoanRequest.request_id).all()
    assert [r.slot_id for r in rows] == ["1", "3"]


def test_list_active_loans_returns_joined_metadata(seeded_db, backend_modules):
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_1", user_id="user_1", tool_item_id="tool_3", status="active")

    rows = backend_modules.user_flow.list_active_loans(seeded_db, "user_1")

    assert len(rows) == 1
    assert rows[0]["tool_name"] == "Pliers"
    assert rows[0]["tool_category"] == "Hand Tools"
    assert rows[0]["tool_tag_id"] == "TAG-3"
