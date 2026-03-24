
from fastapi import HTTPException
import importlib

from .helpers import create_open_loan


def test_admin_create_user_and_duplicate_card_conflict(db_session, backend_modules):
    schemas = importlib.import_module("app.schemas")
    body = schemas.AdminUserCreate(
        first_name="New",
        last_name="User",
        card_id="CARD-X",
        role="student",
        status="active",
    )
    user = backend_modules.admin_crud.create_user(db_session, body)
    assert user.card_id == "CARD-X"

    try:
        backend_modules.admin_crud.create_user(db_session, body)
        assert False, "expected conflict"
    except HTTPException as exc:
        assert exc.status_code == 409
        assert exc.detail == "card_id_already_in_use"


def test_drop_unconfirmed_tool_item_deactivates_inventory(seeded_db, backend_modules):
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_drop", user_id="user_1", tool_item_id="tool_1", status="unconfirmed")

    out = backend_modules.admin_crud.drop_unconfirmed_tool_item(seeded_db, "tool_1")

    tool = seeded_db.get(backend_modules.models.ToolItem, "tool_1")
    loan = seeded_db.get(backend_modules.models.Loan, "loan_drop")
    assert out["status"] == "canceled"
    assert tool.is_active is False
    assert loan.status == "canceled"
    assert loan.returned_at is not None


def test_admin_assign_user_card_route_conflict(client, seeded_db, backend_modules):
    second = backend_modules.models.User(
        user_id="user_2",
        card_id="CARD-2",
        first_name="Other",
        last_name="Student",
        role="student",
        status="good",
    )
    seeded_db.add(second)
    seeded_db.commit()

    resp = client.put("/api/admin/users/user_2/card", json={"card_id": "CARD-1"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "card already assigned to another user"


def test_admin_hardware_command_route_publishes_message(client, seeded_db):
    resp = client.post(
        "/api/admin/hardware/cakes/1/cmd",
        json={"command": "zero", "args": {"force": True}},
    )

    assert resp.status_code == 200, resp.text
    msg = client.app.state.mqtt.published[-1]
    assert msg["topic"] == "igen/cmd/hardware/cake"
    assert msg["payload"]["cake_id"] == 1
    assert msg["payload"]["command"] == "zero"


def test_admin_inventory_endpoint_counts_checked_out_items(client, seeded_db, backend_modules):
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_admin", user_id="user_1", tool_item_id="tool_1")

    resp = client.get("/api/admin/inventory")
    assert resp.status_code == 200
    rows = {row["tool_model_id"]: row for row in resp.json()}
    assert rows["tm_hex"]["total"] == 2
    assert rows["tm_hex"]["available"] == 1
    assert rows["tm_hex"]["checked_out"] == 1
