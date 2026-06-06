# HAVEN: Data Model + MQTT Contract

Single source of truth for:
- Database schema (tables + key fields)
- MQTT topics and message shapes
- End-to-end workflows (auth → dispense → confirmation → return)

---

## Architecture Context

- **Frontend:** React kiosk UI (user + admin panels)
- **Backend:** FastAPI — the only component that writes to the database
- **DB:** SQLite in WAL mode (schema-compatible with PostgreSQL for production)
- **Messaging:** Eclipse Mosquitto MQTT broker
- **Hardware:**
  - *Wired (current):* ESP32 master via USB serial + Bridge sidecar (MQTT ↔ Serial)
  - *Wireless (future):* ESP32 speaks MQTT directly; Bridge removed

---

## Database

### Design Principles

- No history stored as nested fields — no `loan_history` inside users or tools.
- Dedicated tables for **current truth** (`loans`) and **audit trail** (`events`).
- Tools tracked as **individual physical items** — each has its own RFID tag.
- Quantity is **derived**: count of active `tool_items` per model.
- Only the FastAPI backend writes to the database.

---

### Tables

#### `users`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | PK | |
| `card_id` | unique | RFID student card UID |
| `student_number` | nullable | |
| `first_name`, `last_name` | | |
| `role` | enum | `student \| staff \| admin` |
| `status` | enum | `active \| banned \| inactive` |
| `created_at`, `updated_at` | | |

---

#### `tool_models`

Tool types/catalog — not individual tools.

| Column | Type | Notes |
|--------|------|-------|
| `tool_model_id` | PK | |
| `name` | | |
| `description` | | |
| `category` | nullable | |
| `image_url` | nullable | |
| `max_loan_hours` | int | Default loan duration |
| `max_qty_per_user` | int | Per-session checkout limit |

---

#### `tool_items`

Individual physical tools. Each has its own RFID tag and a fixed carousel slot.

| Column | Type | Notes |
|--------|------|-------|
| `tool_item_id` | PK | |
| `tool_model_id` | FK → tool_models | |
| `tool_tag_id` | unique | RFID/NFC tag UID |
| `cake_id` | int | Which carousel (0–5) |
| `slot_id` | int | Physical slot index on carousel |
| `condition_status` | enum | `ok \| damaged \| needs_repair \| missing_tag \| retired` |
| `is_active` | bool | |
| `created_at`, `updated_at` | | |

---

#### `loan_requests`

One row per hardware action (dispense or return). Tracks what was asked of the hardware and what happened.

| Column | Type | Notes |
|--------|------|-------|
| `request_id` | PK | Correlation key across MQTT messages |
| `batch_id` | | Groups multiple requests from one user action |
| `request_type` | enum | `dispense \| return \| admin` |
| `user_id` | FK → users | |
| `tool_item_id` | FK → tool_items | |
| `slot_id` | | Resolved slot at time of request |
| `loan_period_hours` | nullable | Null for return/admin |
| `hw_status` | enum | `pending \| accepted \| in_progress \| dispensed_ok \| confirmed \| return_ok \| failed` |
| `hw_error_code` | nullable | e.g. `JAM_GANTRY`, `ENC_MISMATCH`, `TIMEOUT` |
| `hw_error_reason` | nullable | Human-readable error |
| `created_at`, `hw_updated_at` | | |

---

#### `loans`

Source of truth for who currently has what tool.

| Column | Type | Notes |
|--------|------|-------|
| `loan_id` | PK | |
| `user_id` | FK → users | |
| `tool_item_id` | FK → tool_items | |
| `issued_at` | | When hardware confirmed dispense |
| `due_at` | | `issued_at + loan_period_hours` |
| `confirmed_at` | | Set when user taps tool RFID tag |
| `returned_at` | nullable | NULL if still active |
| `status` | enum | `active \| overdue \| returned \| lost \| damaged` |

**Constraint:** Only one active loan per tool item (`unique on tool_item_id where returned_at IS NULL`).

---

#### `cake_slot_state`

Live occupancy of each carousel slot. Updated on every confirmed dispense and successful return.

| Column | Type | Notes |
|--------|------|-------|
| `cake_id` | PK (composite) | Carousel index |
| `slot_index` | PK (composite) | Slot position on that carousel |
| `tool_item_id` | FK → tool_items, nullable | NULL = empty slot |

---

#### `cake_state`

Current rotational position of each carousel, as reported by encoders.

| Column | Type | Notes |
|--------|------|-------|
| `cake_id` | PK | |
| `current_slot` | int | Which slot is currently at the dispense/return window |

---

#### `events`

Append-only audit log. Every MQTT message received is logged here before any processing.

| Column | Type | Notes |
|--------|------|-------|
| `event_id` | PK | |
| `ts` | | |
| `event_type` | | e.g. `mqtt:igen/evt/dispense`, `rfid_card_scan`, `fault` |
| `actor_type` | enum | `user \| system` |
| `actor_id` | nullable | `user_id` if applicable |
| `request_id` | nullable | Correlation back to `loan_requests` |
| `tool_item_id` | nullable | |
| `payload_json` | | Full raw MQTT payload — never truncated |

---

#### `auth_sessions`

Session tokens issued after successful RFID card authentication.

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | PK | |
| `user_id` | FK → users | |
| `token` | unique | Stored in HTTP-only cookie |
| `expires_at` | | Checked on every authenticated request |
| `created_at` | | |

---

## MQTT Contract

### Topic Naming

All topics prefixed with `igen/`.

### Commands — Backend → Hardware

| Topic | Purpose |
|-------|---------|
| `igen/cmd/dispense` | Dispense a specific tool item |
| `igen/cmd/return` | Return a tool to its slot |
| `igen/cmd/rfid/set_mode` | Switch RFID reader between `card` and `tool` scan modes |
| `igen/cmd/admin/rehome` | Home all axes |
| `igen/cmd/admin/motor_test` | Test a single motor without DB mutation |
| `igen/cmd/admin/set_mode` | Set overall system mode |

### Events — Hardware → Backend

| Topic | Purpose |
|-------|---------|
| `igen/evt/dispense` | Dispense stage update |
| `igen/evt/return` | Return stage update |
| `igen/evt/rfid/card_scan` | User card tapped |
| `igen/evt/rfid/tool_scan` | Tool tag tapped (dispense confirmation) |
| `igen/evt/system/fault` | Hardware fault |
| `igen/evt/system/status` | Heartbeat |

---

## Message Shapes

All action messages include `request_id` and `ts` (ISO 8601).

### Dispense Command
```json
{
  "request_id": "batch_ab12_item_1",
  "action": "dispense",
  "user_id": "user_123",
  "tool_item_id": "toolitem_555",
  "slot_id": "cake_1_slot_5",
  "loan_period_hours": 24,
  "ts": "2026-01-15T14:00:00Z"
}
```

### Dispense Event
```json
{
  "request_id": "batch_ab12_item_1",
  "event": "dispense_status",
  "stage": "accepted",
  "error_code": null,
  "error_reason": null,
  "ts": "2026-01-15T14:00:01Z"
}
```
Stages: `accepted → in_progress → succeeded | failed`

### Return Command
```json
{
  "request_id": "retbatch_cd34_item_1",
  "action": "return",
  "user_id": "user_123",
  "loan_id": "loan_999",
  "tool_item_id": "toolitem_555",
  "slot_id": "cake_1_slot_5",
  "ts": "2026-01-15T14:10:00Z"
}
```

### Return Event
```json
{
  "request_id": "retbatch_cd34_item_1",
  "event": "return_status",
  "stage": "succeeded",
  "error_code": null,
  "error_reason": null,
  "ts": "2026-01-15T14:10:05Z"
}
```

### RFID Card Scan
```json
{
  "card_id": "0xA1B2C3",
  "reader_id": "kiosk_1_reader_1",
  "ts": "2026-01-15T13:58:00Z"
}
```

### RFID Tool Tag Scan
```json
{
  "tool_tag_id": "0xDEADBEEF",
  "reader_id": "kiosk_1_reader_1",
  "ts": "2026-01-15T14:02:00Z"
}
```

---

## Workflows

### A) RFID Authentication

1. Frontend publishes `rfid/set_mode {mode:"card"}` to prime the reader.
2. User taps student card; RFID sidecar publishes `igen/evt/rfid/card_scan`.
3. Backend MQTT listener logs event to `events` table, stores scan in in-memory inbox.
4. Frontend polls `GET /rfid/consume?kind=card` (~300ms) until scan appears.
5. Frontend calls `POST /auth/card {card_id}` → backend resolves to user, issues session token.

### B) Dispense (with RFID Confirmation)

1. User selects tools; frontend calls `POST /dispense`.
2. Backend allocates `tool_item_id` and `slot_id`, inserts `loan_requests` rows with `hw_status=pending`.
3. Backend publishes one `igen/cmd/dispense` per request.
4. Bridge sidecar translates to serial `DISPENSE <request_id> <slot_id>`.
5. ESP32 master: sends `DOCK_TO` to Gantry via CAN, then `ROTATE_TO` to Cake via CAN.
6. ESP32 replies to bridge via serial; bridge publishes `igen/evt/dispense` stages.
7. Backend updates `loan_requests.hw_status` at each stage.
8. Frontend polls `GET /dispense/{batch_id}/status` until all requests reach `dispensed_ok` or `failed`.
9. Frontend switches RFID to tool mode; user taps tool tag.
10. Frontend calls `POST /dispense/requests/{request_id}/confirm {tool_tag_id}`.
11. Backend creates `loans` row: sets `issued_at`, `due_at`, `confirmed_at`, `status=active`.

### C) Return

1. User selects active loans; frontend calls `POST /return`.
2. Backend validates loans belong to user, inserts return `loan_requests`.
3. Backend publishes `igen/cmd/return` per tool.
4. Hardware executes reverse sequence (dock → rotate); publishes `igen/evt/return` stages.
5. On `succeeded`: backend sets `returned_at`, marks loan `returned`, updates `cake_slot_state`.
6. On `failed`: loan_request marked failed; flagged for manual intervention.

---

## Implementation Notes

- Backend is the single writer to SQLite.
- Use WAL mode: `PRAGMA journal_mode=WAL` on connection.
- Every command and event carries `request_id` — no correlation without it.
- Log raw `payload_json` in `events` before any processing; never mutate it.
- Frontend polling is intentional; switch to WebSocket only if latency becomes a user issue.
- `cake_slot_state` is the live truth; `tool_items.slot_id` is the static assignment.
