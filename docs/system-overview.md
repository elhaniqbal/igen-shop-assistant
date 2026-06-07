# HAVEN: System Sequence Diagrams

Full-detail sequence diagrams for each major flow.

**Hardware note:** All motor control goes through Klipper via the Moonraker HTTP API. The Bridge sidecar (`bridge.py`) translates MQTT commands into G-code macros (`SA_MOVE_TO_CAKE`, `SA_ROTATE_TO_DISPENSE`, `SA_PARK`, etc.) sent to `POST /printer/gcode/script`. There is no serial protocol to an ESP32 or CAN bus. The sequence diagrams below abbreviate this as "Bridge → Klipper" for readability.

For a detailed breakdown of what the bridge does per step see [`comms-topology.md`](comms-topology.md).

---

## Authentication

```mermaid

sequenceDiagram
    autonumber
    participant U as User
    participant FE as Frontend (React)
    participant BE as Backend (FastAPI)<br/>routes/user.py
    participant MQ as MQTT Broker (Mosquitto)
    participant RFID as RFID Sidecar<br/>rfid_service.py
    participant MQTT as Backend MQTT Listener<br/>mqtt.py
    participant DB as SQLite<br/>(SQLAlchemy)

    Note over RFID: MFRC522 reads UID/text<br/>Publishes scan events via MQTT

    %% Frontend prepares kiosk to accept card scans
    FE->>BE: POST /rfid/set-mode<br/>{reader_id:"kiosk_1_reader_1", mode:"card"}
    Note right of BE: routes/user.py<br/>rfid_set_mode()
    BE->>MQ: PUBLISH igen/cmd/rfid/set_mode<br/>{reader_id, mode:"card"}

    %% User taps card; RFID service publishes scan
    U->>RFID: Tap student card
    RFID->>MQ: PUBLISH igen/evt/rfid/card_scan<br/>{reader_id, uid, tag_id, text, ts}

    %% Backend MQTT listener logs event and updates in-memory inbox
    MQ-->>MQTT: MESSAGE igen/evt/rfid/card_scan
    Note right of MQTT: mqtt.py _handle_mqtt_message()<br/>logs Event(event_type="mqtt:...") to DB
    MQTT->>DB: INSERT events (event_type="mqtt:igen/evt/rfid/card_scan", payload_json)
    Note right of MQTT: mqtt_topic handler<br/>handle_evt_card_scan()
    MQTT->>BE: _rfid_set(reader_id,"card", payload)<br/>(in-memory inbox in routes/user.py)

    %% Frontend polls until scan appears
    loop Poll every ~300ms
        FE->>BE: GET /rfid/consume?reader_id=kiosk_1_reader_1&kind=card
        Note right of BE: routes/user.py<br/>rfid_consume() pops inbox
        alt Scan available
            BE-->>FE: {ok:true, scan:{tag_id:"123...", uid:"123...", ts:"..."}}
        else No scan yet
            BE-->>FE: {ok:false, scan:null}
        end
    end

    %% Frontend performs DB-backed auth using card_id/tag_id
    FE->>BE: POST /auth/card<br/>{card_id:"123..."}
    Note right of BE: routes/user.py (auth route)<br/>calls usecases/rfid_flow.py get_user_by_card()
    BE->>DB: SELECT users WHERE card_id=:card_id
    alt User found and active
        DB-->>BE: User row
        BE-->>FE: {user_id, first_name, last_name, role}
        FE-->>U: Show tool selection UI
    else Not recognized / not active
        DB-->>BE: none OR status != active
        BE-->>FE: HTTP 403 {detail:"card_not_recognized"|"user_not_active"}
        FE-->>U: Show error
    end


```

## Dispense

```mermaid

sequenceDiagram
    autonumber
    participant U as User
    participant FE as Frontend (React)
    participant BE as Backend (FastAPI)<br/>routes/user.py
    participant UC as Usecases<br/>usecases/user_flow.py
    participant DB as SQLite
    participant MQ as MQTT Broker
    participant MQTT as Backend MQTT Listener<br/>mqtt.py
    participant BR as Bridge Sidecar<br/>bridge.py (MQTT→Moonraker)
    participant MR as Moonraker API<br/>(:7125)
    participant KL as Klipper<br/>(BTT Octopus MAX EZ)
    participant RFID as RFID Sidecar<br/>rfid_service.py

    %% ========== DISPENSE REQUEST ==========
    U->>FE: Select tools + press Dispense
    FE->>BE: POST /dispense<br/>{user_id, items:[{tool_model_id, qty?...}], loan_period_hours}
    Note right of BE: routes/user.py dispense()
    BE->>UC: create_dispense_batch(db,user_id,items,loan_period)
    Note right of UC: validates inventory/user + allocates tool_item_id + slot_id
    UC->>DB: INSERT loan_requests (batch_id, request_id, tool_item_id, slot_id, hw_status="pending")
    DB-->>UC: ok
    UC-->>BE: {batch_id, request_ids:[...]}
    BE-->>FE: 200 {batch_id, request_ids}

    %% Publish hardware commands (one per request_id)
    loop For each request_id
        BE->>MQ: PUBLISH igen/cmd/dispense<br/>{request_id, action:"dispense", user_id, tool_item_id, slot_id, loan_period_hours, ts}
    end

    %% ========== HARDWARE PIPELINE ==========
    MQ-->>BR: MESSAGE igen/cmd/dispense
    Note right of BR: bridge.py _execute_request("dispense")<br/>runs in background thread
    BR->>MQ: PUBLISH igen/evt/dispense<br/>{request_id, stage:"accepted", ts}
    BR->>MR: GET /printer/info<br/>GET /printer/objects/query
    Note right of MR: check klippy_state=ready<br/>check not in error/shutdown
    MR-->>BR: machine status OK

    BR->>MQ: PUBLISH igen/evt/dispense {stage:"in_progress"}

    BR->>MQ: PUBLISH igen/evt/dispense {stage:"move_to_cake"}
    BR->>MR: POST /printer/gcode/script<br/>{"script": "SA_MOVE_TO_CAKE CAKE=<n>"}
    MR->>KL: execute gcode macro
    KL-->>MR: ok
    MR-->>BR: HTTP 200

    BR->>MQ: PUBLISH igen/evt/dispense {stage:"rotate_cake"}
    Note right of BR: computes slot delta (signed shortest path)<br/>builds rotation script
    loop N × 60° steps
        BR->>MR: POST /printer/gcode/script<br/>{"script": "MOVE_CAKE_CW_60 CAKE=<n>"}
        MR->>KL: execute
        KL-->>MR: ok
    end
    BR->>MR: POST /printer/gcode/script<br/>{"script": "SA_ROTATE_TO_DISPENSE CAKE=<n>"}
    MR->>KL: execute
    KL-->>MR: ok

    BR->>MQ: PUBLISH igen/evt/dispense {stage:"move_to_door"}
    BR->>MR: POST /printer/gcode/script {"script": "SA_MOVE_TO_DOOR"}
    MR->>KL: execute
    KL-->>MR: ok

    BR->>MQ: PUBLISH igen/evt/dispense {stage:"waiting_user_confirm"}
    Note right of BR: bridge blocks thread waiting for<br/>igen/cmd/hardware/confirm (timeout: 20s)

    alt User confirms (taps confirm or RFID) within timeout
        MQ-->>BR: MESSAGE igen/cmd/hardware/confirm {request_id}
    else Timeout — auto-complete as unconfirmed
        Note right of BR: loan still created, confirmed_at left null
    end

    BR->>MQ: PUBLISH igen/evt/dispense {stage:"park"}
    BR->>MR: POST /printer/gcode/script {"script": "SA_PARK"}
    MR->>KL: execute
    KL-->>MR: ok

    BR->>MQ: PUBLISH igen/evt/dispense<br/>{stage:"succeeded", cake_id, source_slot, target_slot}

    %% ========== BACKEND EVENT APPLY ==========
    MQ-->>MQTT: MESSAGE igen/evt/dispense
    Note right of MQTT: mqtt.py logs to DB events table first
    MQTT->>DB: INSERT events (mqtt:igen/evt/dispense, payload_json)
    Note right of MQTT: mqtt_topic handler updates LoanRequest
    MQTT->>DB: UPDATE loan_requests SET hw_status="accepted|in_progress|dispensed_ok|failed", hw_error_code...

    %% ========== FRONTEND POLLING ==========
    loop Poll every ~500ms while animation plays
        FE->>BE: GET /dispense/{batch_id}/status
        Note right of BE: routes/user.py dispense_status()
        BE->>DB: SELECT loan_requests WHERE batch_id=:batch_id
        DB-->>BE: rows
        BE-->>FE: {batch_id, items:[{request_id, hw_status, hw_error_code?}]}
        FE-->>U: Update UI + keep spinning until all done
    end

    %% ========== TOOL CONFIRMATION (post-success) ==========
    Note over FE,BE: After hw_status="dispensed_ok"<br/>frontend requires tool scan confirmation

    FE->>BE: POST /rfid/set-mode<br/>{reader_id:"kiosk_1_reader_1", mode:"tool"}
    BE->>MQ: PUBLISH igen/cmd/rfid/set_mode<br/>{reader_id, mode:"tool"}

    U->>RFID: Tap tool tag
    RFID->>MQ: PUBLISH igen/evt/rfid/tool_scan<br/>{reader_id, uid, tag_id, ts}

    MQ-->>MQTT: MESSAGE igen/evt/rfid/tool_scan
    MQTT->>DB: INSERT events (mqtt:igen/evt/rfid/tool_scan,...)
    MQTT->>BE: _rfid_set(reader_id,"tool",payload)

    loop Poll until tool scan present
        FE->>BE: GET /rfid/consume?reader_id=kiosk_1_reader_1&kind=tool
        alt Scan present
            BE-->>FE: {ok:true, scan:{tag_id:"987..."}}
        else
            BE-->>FE: {ok:false, scan:null}
        end
    end

    %% Confirm pickup in DB
    FE->>BE: POST /dispense/requests/{request_id}/confirm<br/>{tool_tag_id:"987..."}
    Note right of BE: routes/user.py dispense_confirm_request()
    Note right of BE: 1) find ToolItem by tool_tag_id
    Note right of BE: 2) match pending dispensed LoanRequest for user/tool_item
    Note right of BE: 3) create Loan + set confirmed_at
    BE->>DB: SELECT tool_items WHERE tool_tag_id=:tool_tag_id
    BE->>DB: SELECT loan_requests WHERE user_id AND tool_item_id AND hw_status="dispensed_ok"
    BE->>DB: INSERT loans (status="active", due_at=issued_at+loan_period)
    BE-->>FE: 200 {ok:true, loan_id}

```

## Return
```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant FE as Frontend (React)
    participant BEU as Backend User Routes<br/>routes/user.py
    participant BEA as Backend Admin Routes<br/>routes/admin.py
    participant UC as Usecases<br/>usecases/user_flow.py
    participant DB as SQLite
    participant MQ as MQTT Broker
    participant MQTT as Backend MQTT Listener<br/>mqtt.py
    participant BR as Bridge Sidecar<br/>bridge.py (MQTT→Moonraker)
    participant MR as Moonraker API<br/>(:7125)
    participant KL as Klipper<br/>(BTT Octopus MAX EZ)
    participant RFID as RFID Sidecar

    %% ================= RETURN: require card scan first (your UX rule) =================
    Note over FE,BEU: Return requires card scan first

    FE->>BEU: POST /rfid/set-mode<br/>{reader_id:"kiosk_1_reader_1", mode:"card"}
    BEU->>MQ: PUBLISH igen/cmd/rfid/set_mode<br/>{reader_id, mode:"card"}

    U->>RFID: Tap card
    RFID->>MQ: PUBLISH igen/evt/rfid/card_scan<br/>{reader_id, tag_id, ts}
    MQ-->>MQTT: MESSAGE igen/evt/rfid/card_scan
    MQTT->>DB: INSERT events(mqtt:...card_scan)
    MQTT->>BEU: _rfid_set(reader_id,"card",payload)

    loop Poll for card scan
        FE->>BEU: GET /rfid/consume?reader_id=kiosk_1_reader_1&kind=card
        BEU-->>FE: {ok:true/false, scan:?}
    end

    FE->>BEU: POST /auth/card<br/>{card_id: scan.tag_id}
    BEU->>DB: SELECT users by card_id
    BEU-->>FE: {user_id,...}

    %% Load active loans
    FE->>BEU: GET /loans?user_id=...
    Note right of BEU: routes/user.py loans()
    BEU->>DB: SELECT loans WHERE user_id AND returned_at IS NULL
    DB-->>BEU: loans
    BEU-->>FE: {loans:[...]}

    %% Start return batch
    U->>FE: Select tools to return
    FE->>BEU: POST /return<br/>{user_id, items:[{tool_item_id,...}]}
    BEU->>UC: create_return_batch(...)
    UC->>DB: INSERT loan_requests(request_type="return", hw_status="pending")
    UC-->>BEU: {batch_id, request_ids}
    BEU-->>FE: 200 {batch_id, request_ids}

    %% Publish return command(s)
    loop each request_id
        BEU->>MQ: PUBLISH igen/cmd/return<br/>{request_id, action:"return", user_id, tool_item_id, slot_id, ts}
    end

    %% Hardware pipeline
    MQ-->>BR: MESSAGE igen/cmd/return
    BR->>MQ: PUBLISH igen/evt/return {request_id, stage:"accepted"}
    BR->>MR: GET /printer/info (assert machine ready)
    MR-->>BR: ok
    BR->>MQ: PUBLISH igen/evt/return {stage:"in_progress"}

    BR->>MQ: PUBLISH igen/evt/return {stage:"move_to_door"}
    BR->>MR: POST /printer/gcode/script {"script":"SA_MOVE_TO_DOOR"}
    MR->>KL: execute
    KL-->>MR: ok

    BR->>MQ: PUBLISH igen/evt/return {stage:"waiting_user_insert"}
    Note right of BR: bridge blocks waiting for igen/cmd/hardware/confirm<br/>(timeout: 20s — on timeout, parks and fails)

    alt User places tool and confirms
        MQ-->>BR: MESSAGE igen/cmd/hardware/confirm {request_id}
    else Timeout
        BR->>MR: POST /printer/gcode/script {"script":"SA_PARK"}
        BR->>MQ: PUBLISH igen/evt/return {stage:"failed", error_code:"USER_INSERT_TIMEOUT"}
    end

    BR->>MQ: PUBLISH igen/evt/return {stage:"move_to_cake"}
    BR->>MR: POST /printer/gcode/script {"script":"SA_MOVE_TO_CAKE_RET CAKE=<n>"}
    MR->>KL: execute
    KL-->>MR: ok

    Note right of BR: bounded return: rotate CCW 1 slot to clear the window<br/>then settle with SA_ROTATE_TO_RETURN
    BR->>MQ: PUBLISH igen/evt/return {stage:"rotate_cake"}
    BR->>MR: POST /printer/gcode/script {"script":"MOVE_CAKE_CCW_60 CAKE=<n>"}
    BR->>MR: POST /printer/gcode/script {"script":"SA_ROTATE_TO_SLOT CAKE=<n> SLOT=<target>"}
    BR->>MR: POST /printer/gcode/script {"script":"SA_ROTATE_TO_RETURN CAKE=<n>"}
    MR->>KL: execute each
    KL-->>MR: ok

    BR->>MQ: PUBLISH igen/evt/return {stage:"park"}
    BR->>MR: POST /printer/gcode/script {"script":"SA_PARK"}
    MR->>KL: execute
    KL-->>MR: ok

    BR->>MQ: PUBLISH igen/evt/return {stage:"succeeded", cake_id, source_slot, target_slot, final_current_slot}

    %% Backend applies return events to DB
    MQ-->>MQTT: MESSAGE igen/evt/return
    MQTT->>DB: INSERT events(mqtt:igen/evt/return)
    MQTT->>DB: UPDATE loan_requests.hw_status ...
    Note right of MQTT: apply_return_event() also marks Loan returned_at/status when succeeded

    %% Frontend polling on return batch
    loop Poll every ~500ms
        FE->>BEU: GET /return/{batch_id}/status
        BEU->>DB: SELECT loan_requests WHERE batch_id=:batch_id
        BEU-->>FE: {items:[{request_id, hw_status, hw_error_code?}]}
    end

    %% ================= ADMIN: MOTOR TEST (no DB updates) =================
    Note over FE,BEA: Admin test does not touch loans/inventory DB

    FE->>BEA: POST /admin/test/motor<br/>{motor_id: 2..10, action:"dispense"|"return"}
    Note right of BEA: routes/admin.py stores in-memory status keyed by request_id
    BEA->>MQ: PUBLISH igen/cmd/admin_test/motor<br/>{request_id, motor_id, action}
    BEA-->>FE: 200 {request_id}

    %% Bridge handles admin test: runs real Klipper moves, no DB changes
    MQ-->>BR: MESSAGE igen/cmd/admin_test/motor
    BR->>MQ: PUBLISH igen/evt/admin_test/motor {stage:"accepted"}
    Note right of BR: asserts machine homed before proceeding
    BR->>MR: GET /printer/info (assert ready + homed)
    MR-->>BR: ok
    BR->>MQ: PUBLISH igen/evt/admin_test/motor {stage:"in_progress"}

    Note right of BR: dispense test: move_to_cake → rotate slot 0→1<br/>→ rotate_to_dispense → move_to_door → 5s dwell → park
    BR->>MR: POST /printer/gcode/script (SA_MOVE_TO_CAKE, rotate macros, SA_MOVE_TO_DOOR, SA_PARK)
    MR->>KL: execute each macro
    KL-->>MR: ok (or error)
    BR->>MQ: PUBLISH igen/evt/admin_test/motor {stage:"succeeded|failed", error_code?}

    %% Backend mqtt.py handler updates in-memory test status only
    MQ-->>MQTT: MESSAGE igen/evt/admin_test/motor
    Note right of MQTT: dispatch_mqtt -> handler updates admin in-memory store
    MQTT->>BEA: _set_motor_test_status(request_id, payload) (in-memory)

    %% Frontend polling test status
    loop Poll every ~300ms
        FE->>BEA: GET /admin/test/motor/{request_id}/status
        BEA-->>FE: {request_id, stage, error_code?}
    end
```