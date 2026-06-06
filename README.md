<div align="center">

# HAVEN

**Automated tool dispensing and return kiosk — UBC IGEN 430 Capstone**

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![Klipper](https://img.shields.io/badge/Klipper-motion_control-red)](https://klipper3d.org)

</div>

---

A student taps their UBC card, selects tools on a touchscreen kiosk, and the machine retrieves them — a gantry positions itself over the right carousel, rotates it to the target slot, and presents the tool at the door. Returns work in reverse. The system tracks loans, flags overdues, and sends email alerts. All services run in Docker on a Raspberry Pi.

This is a capstone demo, not a production system. It runs end-to-end on real hardware but hasn't been hardened for unattended use.

---

## Demo

<div align="center">

https://youtu.be/GPG5MJTYQkU

</div>

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                 Raspberry Pi (Docker Compose)             │
│                                                          │
│  React Kiosk ──── HTTP polling ────► FastAPI Backend     │
│  (Nginx :8080)                       (Uvicorn :8000)     │
│                                      SQLite/SQLAlchemy   │
│                                            │             │
│                                       MQTT pub/sub       │
│                                            │             │
│                                  Eclipse Mosquitto       │
│                                   (1883 / WS:9001)       │
│                                            │             │
│                              ┌─────────────┴──────────┐  │
│                         Bridge sidecar      RFID sidecar │
│                         (bridge.py)        (rfid_service)│
│                              │                   │       │
└──────────────────────────────┼───────────────────┼───────┘
                               │ HTTP              │ SPI/GPIO
                        Moonraker API         MFRC522 reader
                        (:7125)
                               │ G-code macros
                            Klipper
                               │
                      BTT Octopus MAX EZ
                               │
              gantry1 / gantry2 / horiz / cake steppers
```

The frontend never touches hardware directly. It polls the backend over HTTP; the backend fires MQTT commands; the bridge translates those into Klipper G-code macros via Moonraker's HTTP API. Klipper handles stepper control on the BTT Octopus board.

The bridge has two modes set via `BRIDGE_MODE`: `MOONRAKER` calls real hardware, `SIM` runs a software simulation with configurable timing and fail rate — no physical machine required.

---

## Hardware

**Gantry and carousels**

The machine has a horizontal axis (`manual_stepper horiz`) that positions the gantry over a carousel, dual vertical axes (`gantry1`, `gantry2`) that lift tools in and out of slots, and six carousel stepper motors — each carousel ("cake") has 6 slots, 60° per step.

Vertical homing can't use Klipper's native `G28` because both sides of the gantry need to find their endstops independently. Instead, `vertical_home.py` jogs each side in small increments and polls Moonraker's endstop API until both trigger, then zeros both steppers.

**Klipper macros (selected)**

```
SA_MOVE_TO_CAKE CAKE=<n>              position gantry over carousel n
SA_ROTATE_TO_SLOT CAKE=<n> SLOT=<s>   rotate carousel to absolute slot
MOVE_CAKE_CW_60 CAKE=<n>              rotate one slot clockwise
MOVE_CAKE_CCW_60 CAKE=<n>             rotate one slot counter-clockwise
SA_ROTATE_TO_DISPENSE CAKE=<n>        final alignment to dispense window
SA_MOVE_TO_DOOR                       extend gantry to door position
SA_PARK                               return to home/park
SA_HOME_HORIZONTAL                    home horizontal axis
SA_JOG_GANTRY_UP/DOWN DIST=<n>        manual jog (admin)
```

**Custom PCB — Encoder multiplexer**

<div align="center">
<img src="assets/encoder_mux_pcb.png" alt="Encoder Multiplexer PCB" width="500"/>
</div>

Each carousel has an AS5600 magnetic absolute encoder. Since all AS5600s share I2C address `0x36`, a TCA9548A multiplexer switches between them. An ESP32 reads all six, persists per-carousel zero offsets to EEPROM, and exposes a simple serial command interface. When `ENCODER_SERIAL_ENABLED=1`, the bridge reads angle before and after each rotation and fires an alert if the delta is outside tolerance. It's a sanity check — mismatches are logged and surfaced in the admin panel, but the operation isn't halted.

**NFC student card**

<div align="center">
<img src="assets/custom_pcb_card.png" alt="Custom NFC card PCB" width="400"/>
</div>

The authentication card is a custom PCB — originally a personal side project to make a business-card-sized NFC tag. It's ISO 14443 compliant, so the MFRC522 reads it identically to any standard card. No firmware changes were needed to support it.

---

## Sequence diagrams

<table>
<tr>
<td align="center">
<img src="assets/sequence_diagram_dispense_simplified.png" alt="Dispense" width="370"/>
<br/><sub>Dispense</sub>
</td>
<td align="center">
<img src="assets/sequence_diagram_return_simplified.png" alt="Return" width="370"/>
<br/><sub>Return</sub>
</td>
</tr>
</table>

Full diagrams with per-stage MQTT events and Moonraker calls: [`docs/system-overview.md`](docs/system-overview.md)

---

## Screenshots

<table>
<tr>
<td align="center"><img src="assets/demo_admin_ui_manual_control.png" width="380"/><br/><sub>Admin panel — manual gantry and carousel control</sub></td>
<td align="center"><img src="assets/cake_and_slot_state.png" width="380"/><br/><sub>Carousel slot state view</sub></td>
</tr>
</table>

---

## Poster

<div align="center">
<img src="assets/Poster.svg" alt="HAVEN Project Poster" width="700"/>
</div>

---

## Stack

| | |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Python 3.11, FastAPI, SQLAlchemy 2.0, Pydantic |
| Messaging | Eclipse Mosquitto 2, Paho |
| Database | SQLite (WAL mode) |
| Motion control | Klipper, Moonraker HTTP API |
| Firmware | Arduino/PlatformIO, ESP32, AS5600, TCA9548A |
| Infrastructure | Docker Compose, Nginx |
| Notifications | SendGrid |
| Hardware | BTT Octopus MAX EZ, MFRC522 RFID, NEMA steppers |

---

## Getting started

**Prerequisites:** Docker, Docker Compose, Git

### 1. Clone and configure

```bash
git clone https://github.com/elhaniqbal/igen-shop-assistant.git
cd igen-shop-assistant
```

Create a `.env` in the repo root. Minimum to run without hardware:

```env
DATABASE_URL=sqlite:////app/data/igen.db
MQTT_BROKER=mqtt
MQTT_PORT=1883

# SIM runs without any physical hardware attached
BRIDGE_MODE=SIM

# Set to 1 to mock RFID scans in the browser
VITE_MOCK=1

# Only used in MOONRAKER mode
MOONRAKER_URL=http://host.docker.internal:7125

SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
```

### 2. Build and start

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Kiosk | http://localhost:8080 |
| Backend | http://localhost:5000 |
| MQTT Web UI | http://localhost:8090 |
| DB Admin | http://localhost:8083 |

The database is created automatically at `./data/igen.db` on first run.

`5000:8000` is a dev convenience — in production, remove that port mapping and let Nginx proxy the backend internally. It's already on the `internal` Docker network; nothing outside the host needs to reach it directly.

### 3. Create the first admin user

There's no seed data. The admin endpoints have no auth guard (see [rough edges](#rough-edges)), so you can bootstrap directly:

```bash
curl -s -X POST http://localhost:5000/api/admin/users \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Admin",
    "last_name": "User",
    "role": "admin",
    "status": "active",
    "card_id": "your-rfid-card-uid"
  }'
```

If you don't have your card UID yet, omit `card_id` and patch it in after scanning. The API's interactive docs at `http://localhost:5000/docs` work fine for this too.

### 4. Seed inventory

Before anything can be dispensed, you need tool models (`POST /api/admin/tool-models`) and tool items (`POST /api/admin/tool-items`) with their RFID tags and carousel slot assignments.

### Running against real hardware

Set `BRIDGE_MODE=MOONRAKER` and point `MOONRAKER_URL` at your Moonraker instance. The RFID sidecar needs SPI/GPIO access to the MFRC522 — the relevant device mounts are already in `docker-compose.yaml`, just uncomment them.

Crowsnest (Klipper camera streaming) runs as a system service on the Pi, not in Docker. Set its port to `8091` to avoid conflicting with the kiosk on `8080`:

```conf
# /home/pi/printer_data/config/crowsnest.conf
[cam 1]
mode: ustreamer
port: 8091
device: /dev/v4l/by-id/usb-ARDUCAM_<your-camera>-video-index0
resolution: 1280x720
max_fps: 20
```

### Remote access via Tailscale

[Tailscale](https://tailscale.com) is what we use for remote access. `tailscale serve` proxies a local port to your tailnet over HTTPS; `tailscale funnel` makes it publicly reachable.

Tailnet-only (recommended for admin tools):

```bash
tailscale serve --bg http://localhost:8080   # kiosk at https://<hostname>.ts.net
tailscale serve --bg --tcp 8090 tcp://localhost:8090  # MQTT Web UI
tailscale serve --bg --tcp 8083 tcp://localhost:8083  # DB Admin
tailscale serve --bg --tcp 8091 tcp://localhost:8091  # Crowsnest camera
```

Public via Funnel (for a live demo):

```bash
tailscale serve --bg http://localhost:8080
tailscale funnel --bg 443
```

Keep the MQTT broker (1883), Moonraker (7125), and the backend (5000) off Tailscale entirely — none of them have auth.

---

## Rough edges

**Klipper positions aren't in physical units.** Reported positions (`horizontal_position`, `vertical_position`) are raw step-count values, not millimeters. When we switched to Klipper from the previous control architecture, `rotation_distance` was never configured on the `MANUAL_STEPPER` definitions. Calibration is done empirically in step units; the numbers the admin panel shows are meaningless without context.

**Admin routes have no auth.** Anything that can reach port 5000 can create users, modify loans, or trigger hardware. The kiosk flow uses RFID-issued session tokens; the admin panel was protected by network isolation rather than credentials. This was fine for a closed demo, not fine for anything else.

**No passwords, no JWT.** There are no credentials in the system. Sessions are a random token in an HTTP-only cookie, issued after a card scan. Admin access is by role field, not a separate login. It worked for the demo.

**No crash recovery.** If the bridge crashes mid-dispense, `loan_requests.hw_status` stays `in_progress` and the machine's physical state is unknown. Fix it by rehoming and manually updating the DB.

**Door timeout creates unconfirmed loans.** The bridge waits 20s (`DOOR_CONFIRM_TIMEOUT_S`) for the user to confirm they've taken the tool. On timeout it marks the dispense succeeded anyway — the loan is created without `confirmed_at`.

**Encoder mismatches don't stop anything.** A rotation that doesn't match the expected angle triggers an admin alert and nothing else. The operation completes, the discrepancy is logged.

---

## What's missing for production

**Auth.** Admin routes need session guards and hashed credentials. The RFID kiosk flow is fine; the `/api/admin/*` surface isn't.

**Cloud database.** The schema is already PostgreSQL-compatible (SQLAlchemy 2.0, standard types). Migrating is a `DATABASE_URL` change plus a migration run. A managed Postgres instance would also enable proper backups and multi-site setups.

**Physical coordinates in Klipper.** Setting `rotation_distance` correctly on the `MANUAL_STEPPER` definitions would map G-code positions to millimeters and make calibration significantly less painful.

**Encoder auto-correction.** The pieces exist — the bridge already reads encoder angle before and after each move (`ENCODER_CONFIRM_ENABLED`), and `SA_JOG_CAKE_REL` can apply a delta correction. What's not written is the loop: measure residual error, jog to correct, re-verify. Right now it just alerts.

**Email alert recipients.** The overdue alert recipient is hardcoded in `admin.py`. It needs to be a configurable field.

---

## Repository layout

```
igen-shop-assistant/
├── services/
│   ├── backend/app/
│   │   ├── bridge.py          # MQTT → Moonraker HTTP → Klipper
│   │   ├── vertical_home.py   # Python-assisted dual-gantry homing
│   │   ├── mqtt.py            # MQTT subscriber + event dispatch
│   │   ├── models.py          # SQLAlchemy ORM
│   │   ├── routers/           # FastAPI route handlers
│   │   └── usecases/          # Dispense/return orchestration
│   ├── ui/src/
│   │   ├── pages/             # Login, UserApp, AdminShell
│   │   ├── components/        # RFID panel, overlays, animations
│   │   └── lib/               # API client, endpoint map
│   └── mosquitto/
├── firmware/
│   └── encoder_mux.ino        # ESP32: 6× AS5600 via TCA9548A
├── assets/                    # Demo video, PCBs, diagrams, poster
└── docs/
    ├── model.md               # DB schema + MQTT contract
    ├── system-overview.md     # Full sequence diagrams
    └── comms-topology.md      # Service communication map
```

---