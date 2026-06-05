
from .helpers import create_open_loan


def test_dispense_route_creates_batch_and_publishes_commands(client, seeded_db, backend_modules):
    resp = client.post(
        "/api/dispense",
        json={
            "user_id": "user_1",
            "items": [{"tool_model_id": "tm_hex", "qty": 2}],
            "loan_period_hours": 24,
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["request_ids"]) == 2

    published = client.app.state.mqtt.published
    assert len(published) == 2
    assert all(m["topic"] == "igen/cmd/dispense" for m in published)
    assert {m["payload"]["slot_id"] for m in published} == {"1", "2"}


def test_dispense_route_rejects_invalid_user(client):
    resp = client.post(
        "/api/dispense",
        json={"user_id": "does_not_exist", "items": [{"tool_model_id": "tm_hex", "qty": 1}], "loan_period_hours": 24},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "invalid_user"


def test_return_route_creates_batch_and_publishes_commands(client, seeded_db, backend_modules):
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_1", user_id="user_1", tool_item_id="tool_1")

    resp = client.post(
        "/api/return",
        json={"user_id": "user_1", "items": [{"tool_item_id": "tool_1"}]},
    )

    assert resp.status_code == 200, resp.text
    published = client.app.state.mqtt.published
    assert len(published) == 1
    assert published[0]["topic"] == "igen/cmd/return"
    assert published[0]["payload"]["tool_item_id"] == "tool_1"


def test_loans_route_lists_joined_loans(client, seeded_db, backend_modules):
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_2", user_id="user_1", tool_item_id="tool_3")

    resp = client.get("/api/loans", params={"user_id": "user_1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == "user_1"
    assert body["loans"][0]["tool_name"] == "Pliers"


def test_catalog_route_returns_availability_counts(client, seeded_db, backend_modules):
    create_open_loan(seeded_db, backend_modules.models, loan_id="loan_3", user_id="user_1", tool_item_id="tool_1")

    resp = client.get("/api/catalog")
    assert resp.status_code == 200
    rows = {row["tool_model_id"]: row for row in resp.json()}
    assert rows["tm_hex"]["total"] == 2
    assert rows["tm_hex"]["available"] == 1
    assert rows["tm_hex"]["checked_out"] == 1
