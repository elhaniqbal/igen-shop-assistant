# HAVEN: Communications Topology

---

## Overview

Three communication planes:

1. **HTTP REST** — Frontend ↔ Backend (polling-based, ~300–500ms intervals)
2. **MQTT pub/sub** — Backend ↔ Bridge/RFID sidecars (async, event-driven)
3. **HTTP** — Bridge → Moonraker API → Klipper G-code macros

The backend is the coordinator: it accepts user requests over HTTP, publishes MQTT commands, and reacts to MQTT events from hardware — updating the database and making status available to the polling frontend.

---

## Full topology

```
React Kiosk (Nginx :8080)
        │
        │  HTTP REST  (~300–500ms polling for RFID/status)
        ▼
FastAPI Backend (:8000)
   SQLite / SQLAlchemy
        │
        │  MQTT pub/sub
        ▼
Eclipse Mosquitto (:1883 / WS:9001)
        │
   ┌────┴──────────────┐
   │                   │
Bridge sidecar     RFID sidecar
(bridge.py)        (rfid_service.py)
   │                   │
   │ HTTP              │ SPI/GPIO
   ▼                   ▼
Moonraker API      MFRC522 reader
(:7125)
   │
   │ POST /printer/gcode/script
   ▼
Klipper (running on BTT Octopus MAX EZ)
   │
   │ stepper driver signals
   ▼
gantry1 / gantry2 / horiz / cake0..5 steppers


Optional (ENCODER_SERIAL_ENABLED=1):
Encoder ESP32 ←I2C→ 6× AS5600
        │
        │ USB serial
        ▼
Bridge sidecar (position verification after moves)
```

---

## HTTP layer: Frontend ↔ Backend

The frontend has no persistent connections to the backend. Everything is polling.

### Poll intervals

| What | Endpoint | Interval |
|------|----------|----------|
| RFID card scan | `GET /api/rfid/consume?kind=card` | ~300ms |
| RFID tool scan | `GET /api/rfid/consume?kind=tool` | ~300ms |
| Dispense batch status | `GET /api/dispense/{batch_id}/status` | ~500ms |
| Return batch status | `GET /api/return/{batch_id}/status` | ~500ms |
| Admin motor test | `GET /api/admin/test/motor/{request_id}/status` | ~300ms |

Polling keeps the frontend stateless. The backend's RFID inbox is in-memory; motor test results are in-memory. Everything else lives in the database.

---

## MQTT layer: Backend ↔ Bridge/RFID

The backend publishes commands; Bridge and RFID sidecars publish events.

### Topic hierarchy

```
igen/
├── cmd/                              Backend → Bridge
│   ├── dispense                      Dispense a tool item
│   ├── return                        Return a tool item
│   ├── rfid/set_mode                 Switch reader mode (card | tool)
│   ├── admin/manual                  Manual gantry/cake controls
│   ├── admin/machine                 Machine-level ops (e-stop, restart Klipper)
│   ├── admin/calibration             Calibration commands
│   ├── admin_test/motor              Run motor test (no DB mutation)
│   ├── hardware/confirm              User confirmed at door (approve pending op)
│   └── hardware/cancel               User cancelled at door
│
└── evt/                              Bridge/RFID → Backend
    ├── dispense                      Dispense stage update
    ├── return                        Return stage update
    ├── admin/manual                  Manual op result
    ├── admin/machine                 Machine op result
    ├── admin/calibration             Calibration result
    ├── admin_test/motor              Motor test result
    ├── machine/alert                 Hardware alerts (sticky, ack-required)
    ├── machine/status                Machine status snapshot
    ├── hardware/wait                 Bridge is waiting for user confirmation
    ├── rfid/card_scan                User card tapped
    └── rfid/tool_scan                Tool tag tapped (dispense confirmation)
```

### Dispense event stages

A dispense operation progresses through these stages published on `igen/evt/dispense`:

```
accepted          bridge received the command
in_progress       Moonraker call returned OK
move_to_cake      gantry moving to carousel
rotate_cake       carousel rotating to target slot
move_to_door      gantry moving to dispense door
waiting_user_confirm  gantry at door, waiting for user
park              gantry returning to park position
succeeded         operation complete
failed            error — see error_code
```

All messages carry `request_id`, `ts`, and optional `error_code` / `error_reason`.

---

## Bridge: MQTT → Moonraker → Klipper

The bridge (`bridge.py`) is the hardware adapter. It subscribes to `igen/cmd/*` topics, translates each command into one or more Klipper G-code macros, and sends them to Klipper via **Moonraker's HTTP API** (`POST /printer/gcode/script`).

There is no serial protocol to an ESP32 master or CAN bus. All motor control goes through Klipper.

### Example: dispense operation

```
MQTT: igen/cmd/dispense {request_id, cake_id, current_slot, target_slot}
  │
Bridge._execute_request("dispense", payload)
  │
  ├─► _ensure_machine_ready()           GET /printer/info, /printer/objects/query
  │
  ├─► moonraker.send_gcode(             POST /printer/gcode/script
  │       "SA_MOVE_TO_CAKE CAKE=2")
  │
  ├─► _execute_dispense_rotation()
  │     ├─► moonraker.send_gcode("MOVE_CAKE_CW_60 CAKE=2")  × N slots
  │     └─► moonraker.send_gcode("SA_ROTATE_TO_DISPENSE CAKE=2")
  │
  ├─► moonraker.send_gcode("SA_MOVE_TO_DOOR")
  │
  ├─► wait for hardware/confirm MQTT message (DOOR_CONFIRM_TIMEOUT_S, default 20s)
  │
  └─► moonraker.send_gcode("SA_PARK")
  │
MQTT: igen/evt/dispense {request_id, stage:"succeeded", cake_id, source_slot, target_slot}
```

The bridge serializes hardware access with a simple mutex (`_active` field + `_try_claim_machine`). If a second command arrives while one is in progress, it is immediately rejected with `stage: failed, error_code: BUSY`.

### Moonraker API calls used

| Call | Purpose |
|------|---------|
| `GET /server/info` | Check klippy_state before starting an op |
| `GET /printer/info` | Check printer ready state |
| `GET /printer/objects/query` | Read toolhead position, idle state, print_stats |
| `GET /printer/query_endstops/status` | Read endstop triggers (used during homing) |
| `POST /printer/gcode/script` | Run a G-code macro or script |
| `POST /printer/emergency_stop` | Emergency stop |
| `POST /printer/firmware_restart` | Restart Klipper firmware |
| `POST /machine/services/restart` | Restart Klipper service |

### Vertical homing

Klipper's native `G28` homing isn't well-suited to two mechanically independent vertical axes that need to find their endstops separately. The bridge calls a separate Python script (`vertical_home.py`) for this case (`home_mode: python_assisted`):

```
vertical_home.py
  ├─► GET /printer/info  (assert ready)
  ├─► MANUAL_STEPPER STEPPER=gantry1 SET_POSITION=800000
  │   MANUAL_STEPPER STEPPER=gantry2 SET_POSITION=800000
  │
  └─► loop (up to 1000 iterations):
        MANUAL_STEPPER STEPPER=gantry1 MOVE=<pos - 1600> STOP_ON_ENDSTOP=try_probe
        MANUAL_STEPPER STEPPER=gantry2 MOVE=<pos - 1600> STOP_ON_ENDSTOP=try_probe
        GET /printer/query_endstops/status
        stop each side once its endstop triggers
        break when both triggered
  │
  ├─► MANUAL_STEPPER SET_POSITION=0 on both
  └─► SET_GCODE_VARIABLE MACRO=SA_STATE VARIABLE=homed VALUE=1
```

After vertical homing completes, the bridge sends `SA_HOME_HORIZONTAL` for the horizontal axis.

---

## RFID sidecar

`rfid_service.py` polls the MFRC522 reader over SPI/GPIO and publishes scan events to Mosquitto. The reader's mode (card vs. tool) is controlled by the backend via `igen/cmd/rfid/set_mode`.

```
MFRC522 (SPI)
      │
rfid_service.py (polling loop)
      │  MQTT PUBLISH
      ▼
igen/evt/rfid/card_scan  or  igen/evt/rfid/tool_scan
      │
mqtt.py (backend subscriber)
      │  in-memory inbox (dict keyed by reader_id + kind)
      ▼
GET /api/rfid/consume  ← frontend polls this
```

---

## Encoder sidecar (optional)

The encoder ESP32 exposes a serial command interface. The bridge connects to it when `ENCODER_SERIAL_ENABLED=1`. It is used only for position verification — reading the angle before and after a carousel rotation and publishing an alert if the measured delta doesn't match the expected delta.

It does not control the motors. It does not stop an in-progress operation.

```
AS5600 × 6 ←I2C→ TCA9548A ←I2C→ ESP32
                                   │ USB serial
                                   ▼
                              Bridge (EncoderClient)
                               READ cake=<n>  →  adj_deg=<float>
                               ZERO cake=<n>
                               SETZERO cake=<n> deg=<float>
```

Commands the bridge sends over serial:

| Command | Response |
|---------|----------|
| `STATUS` | `OK ...` |
| `READ cake=<n>` | `OK cake=<n> ch=<n> raw=<n> deg=<f> zero_deg=<f> adj_deg=<f>` |
| `READEEPROM cake=<n>` | `OK cake=<n> zero_deg=<f> magic=<hex> version=<n>` |
| `ZERO cake=<n>` | Set current angle as zero, persist to EEPROM |
| `SETZERO cake=<n> deg=<f>` | Set explicit zero offset, persist to EEPROM |
| `CLEARZERO cake=<n>` | Clear stored zero |

---

## Bridge simulation mode

With `BRIDGE_MODE=SIM`, the bridge runs a software simulation of the hardware with configurable timing and fail rate:

```
SIM_FAIL_RATE=0.08       8% random failure rate
SIM_MIN_TIME_S=0.4       minimum step duration
SIM_MAX_TIME_S=1.5       maximum step duration
SIM_ACK_DELAY_S=0.05     delay before accepted→in_progress
```

The simulation publishes the same MQTT event stages as real hardware, including the `waiting_user_confirm` pause. Door confirmation still requires a `igen/cmd/hardware/confirm` message.
