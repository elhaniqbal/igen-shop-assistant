# IGEN Shop Assistant: Data Model + MQTT Contract

This document is the single source of truth for:

* Database schema (tables + key fields)
* MQTT topics and message contracts
* End-to-end workflows (RFID auth → dispense w/ confirmation → return)

---

## Architecture context

* Frontend: React (kiosk UI + admin UI)
* Backend: FastAPI (only component that writes to DB)
* DB: SQLite for now (upgrade to cloud based later, e.g supabase etc.)
* Messaging: Mosquitto MQTT broker
* Hardware:

  * **Wired version (current):** ESP32 master via USB serial + Bridge container (MQTT↔Serial)
  * **Wireless version (future):** ESP32 master speaks MQTT directly; Bridge removed

---

## Database choice

### MVP

* **SQLite** 

  * Run in WAL mode. (changes are first written to a separate log file (the WAL file) before being applied to the main database.)
  * Only the FastAPI backend should write to it.

### Production-ish upgrade

* **Cloud based PostgreSQL offerings (e.g Supabase)** 

---

## Data model: core principles

* Do **not** store history as nested fields inside rows.

  * No `history_of_loans` inside tools.
  * No `loan_history` inside students.
* Use dedicated tables for:

  * **current truth** (loans)
  * **audit trail** (events)
* Track tools as **individual physical items** if each tool has its own RFID/NFC tag.

---

## Tables

### 1) users (students + staff/admin)


**USERS**

* `user_id` (PK)
* `card_id` (unique; RFID student card)
* `student_number` (nullable)
* `first_name`, `last_name`
* `role` (student | staff | admin)
* `status` (active | banned | inactive)
* `created_at`, `updated_at`

Notes:

* If staff are not students and don’t have card IDs, keep `card_id` nullable and add username/password or SSO later.

---

### 2) tool_models (tool types)

**tool_models**

* `tool_model_id` (PK)
* `name`
* `description`
* `category` (optional)
* `image_url` (optional)

---

### 3) tool_items (physical tools)

**tool_items**

* `tool_item_id` (PK)
* `tool_model_id` (FK → tool_models)
* `tool_tag_id` (unique; RFID/NFC tag attached to the physical tool)
* `cake_id` (which carousel/cake)
* `slot_id` (physical slot position)
* `condition_status` (ok | damaged | needs_repair | missing_tag | retired)
* `is_active` (boolean)
* `created_at`, `updated_at`

Notes:

* **Qty is derived**: count of active tool_items per model.

---

### 4) loan_requests (hardware-executed actions)

Tracks each requested physical action and the hardware outcome.

**loan_requests**

* `request_id` (PK)
* `batch_id`
* `request_type` (dispense | return | admin)
* `user_id` (FK → users)
* `tool_item_id` (FK → tool_items)

  * If you initially dispense by model, you can temporarily store `tool_model_id` and resolve to an item before issuing hardware command.
* `slot_id`
* `loan_period_hours` (nullable for return/admin)
* `hw_status` (pending | accepted | in_progress | dispensed_ok | confirmed | return_ok | failed)
* `hw_error_code`, `hw_error_reason`
* `created_at`, `hw_updated_at`

---

### 5) loans (source of truth for who has what)

**loans**

* `loan_id` (PK)
* `user_id` (FK → users)
* `tool_item_id` (FK → tool_items)
* `issued_at`
* `due_at`
* `confirmed_at` (set when user taps tool tag after dispense)
* `returned_at` (NULL if active)
* `status` (active | overdue | returned | lost | damaged)

Constraints (recommended):

* Only one active loan per tool item:

  * unique on `tool_item_id` where `returned_at IS NULL`

---

### 6) events (append-only audit log)

**events**

* `event_id` (PK)
* `ts`
* `event_type` (rfid_card_scan | rfid_tool_scan | dispense_cmd | dispense_evt | return_cmd | return_evt | admin_cmd | fault | heartbeat)
* `actor_type` (user | system)
* `actor_id` (nullable; user_id)
* `request_id` (nullable)
* `tool_item_id` (nullable)
* `payload_json` (store full payload for debugging)

Why this exists:

* Debugging + traceability + metrics without polluting primary tables.

---

## MQTT contract

### Topic naming

Prefix all topics with `igen/`.

### Commands (Backend → Hardware)

* `igen/cmd/dispense`
* `igen/cmd/return`
* `igen/cmd/admin/rehome`
* `igen/cmd/admin/motor_test`
* `igen/cmd/admin/set_mode` (optional)

### Events (Hardware → Backend)

* `igen/evt/dispense`
* `igen/evt/return`
* `igen/evt/rfid/card_scan`
* `igen/evt/rfid/tool_scan`
* `igen/evt/system/fault`
* `igen/evt/system/status` (heartbeat)

---

## Message shapes

### Common fields

All action messages should include:

* `request_id`
* `ts` (ISO string)

### Dispense command

Topic: `igen/cmd/dispense`

```json
{
  "request_id": "batch_ab12_item_1",
  "action": "dispense",
  "user_id": "user_123",
  "tool_item_id": "toolitem_555",
  "slot_id": "wheel_01_slot_05",
  "loan_period_hours": 24,
  "ts": "2025-12-16T20:00:00Z"
}
```

### Dispense event

Topic: `igen/evt/dispense`

```json
{
  "request_id": "batch_ab12_item_1",
  "event": "dispense_status",
  "stage": "accepted",
  "error_code": null,
  "error_reason": null,
  "ts": "2025-12-16T20:00:01Z"
}
```

Stages: `accepted | in_progress | succeeded | failed`

### Return command

Topic: `igen/cmd/return`

```json
{
  "request_id": "retbatch_cd34_item_1",
  "action": "return",
  "user_id": "user_123",
  "loan_id": "loan_999",
  "tool_item_id": "toolitem_555",
  "slot_id": "wheel_01_slot_05",
  "ts": "2025-12-16T20:10:00Z"
}
```

### Return event

Topic: `igen/evt/return`

```json
{
  "request_id": "retbatch_cd34_item_1",
  "event": "return_status",
  "stage": "succeeded",
  "error_code": null,
  "error_reason": null,
  "ts": "2025-12-16T20:10:05Z"
}
```

### RFID card scan event

Topic: `igen/evt/rfid/card_scan`

```json
{
  "card_id": "card_0xA1B2C3",
  "reader_id": "reader_entry_01",
  "ts": "2025-12-16T19:58:00Z"
}
```

### RFID tool tag scan event (dispense confirmation)

Topic: `igen/evt/rfid/tool_scan`

```json
{
  "tool_tag_id": "tooltag_0xDEADBEEF",
  "reader_id": "reader_pickup_01",
  "ts": "2025-12-16T20:02:00Z"
}
```

---

## Workflows

### A) RFID user authentication

1. User taps student card on reader.
2. Reader publishes `igen/evt/rfid/card_scan` (or a local service calls backend directly).
3. Backend resolves `card_id → user_id`.
4. Frontend shows tool selection UI.

### B) Dispense workflow (with tool-tap confirmation)

1. Frontend: user selects tools and presses Dispense.
2. Backend (internal): validates inventory and permissions.
3. Backend (DB): inserts `loan_requests` rows with `hw_status=pending`.
4. Backend → MQTT: publishes one message per tool unit to `igen/cmd/dispense`.
5. Hardware executes; Bridge/ESP32 publishes `igen/evt/dispense` success/fail.
6. Backend updates `loan_requests.hw_status` accordingly.
7. User physically takes tool.
8. User taps tool tag on reader.
9. Backend matches `tool_tag_id` to expected dispensed request for that user.
10. Backend creates/activates `loans` row:

    * sets `issued_at`, `due_at`, `confirmed_at`
    * sets status `active`

### C) Return workflow

1. Frontend: user selects active loan(s) and presses Return.
2. Backend validates loans belong to user.
3. Backend inserts return `loan_requests` (or uses `request_type=return`).
4. Backend → MQTT: publishes `igen/cmd/return` per tool.
5. Hardware executes; publishes `igen/evt/return` success/fail.
6. Backend updates:

   * success: set `returned_at`, mark loan `returned`, update inventory state
   * fail: mark request failed and flag for manual intervention

---

## Implementation notes that prevent pain later

* Backend should be the single writer to SQLite.
* Use request correlation everywhere:

  * every command and event includes `request_id`.
* Keep `events` append-only and store raw payload JSON for debugging.
* Start with polling endpoints for frontend; switch to WebSocket later if needed.

---

## Next coding milestones

1. Create DB schema + migrations.
2. Implement FastAPI endpoints:

   * POST /dispense
   * GET /dispense/{batch_id}/status
   * POST /return
   * GET /return/{batch_id}/status
   * POST /rfid/card_auth (or subscribe MQTT)
   * POST /rfid/tool_confirm (or subscribe MQTT)
3. Implement MQTT handlers in backend for:

   * igen/evt/dispense
   * igen/evt/return
   * igen/evt/rfid/card_scan (optional)
   * igen/evt/rfid/tool_scan (optional)
4. Implement Bridge container (wired version) serial↔MQTT.
