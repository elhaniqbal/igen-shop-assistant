# IGEN Smart Shop Assistant — Monorepo Scaffold (v1)

> Raspberry Pi touchscreen/web UI → **Pi Bridge (MQTT↔UART)** → **Controller MCU (ESP32-S3)** → **CAN bus** → **Cabinet MCUs (ESP32-S3)**. Postgres stores users, tools, loans; Mosquitto is the MQTT broker. This repo is an end‑to‑end template with runnable stubs.

---

## 🗂️ Repository Layout

```
igen-shop-assistant/
├─ README.md                            # Start here (you’re reading the in-repo version)
├─ CONTRIBUTING.md
├─ .gitignore
├─ .github/ (LATER DOWN THE ROAD)
│  ├─ workflows/
│  │  ├─ ci.yml                         # Lint, typecheck, build stubs
│  │  └─ pre-commit.yml
│  └─ ISSUE_TEMPLATE.md
├─ docs/
│  ├─ system-overview.md                # Diagrams + deep dives
│  ├─ comms-topology.md                 # MQTT & CAN topics/IDs
│  ├─ onboarding.md                     # Short onboarding for new devs
│  └─ troubleshooting.md
├─ env/
│  ├─ .env.example                      # Copy to .env (root)
│  └─ secrets.template.md
├─ deploy/ (OPTIONAL FOR NOW)
│  ├─ docker-compose.yml                # Mosquitto, Postgres, Adminer, Backend
│  ├─ mosquitto/
│  │  ├─ mosquitto.conf
│  │  └─ aclfile
│  └─ postgres/
│     └─ init.sql                       # DB schema + seed
├─ services/ (RUNS ON RASPBERRY PI)
│  ├─ backend-fastapi/                  # API + events processor (MQTT↔DB)
│  │  ├─ pyproject.toml
│  │  ├─ app/
│  │  │  ├─ main.py                     # FastAPI app
│  │  │  ├─ deps.py                     # DB & MQTT wiring
│  │  │  ├─ models.py                   # SQLModel ORM
│  │  │  ├─ schemas.py                  # Pydantic (JSON/CBOR contracts)
│  │  │  ├─ mqtt_handlers.py            # Subscriptions/handlers
│  │  │  └─ routes/
│  │  │     ├─ admin.py
│  │  │     └─ student.py
│  │  └─ tests/
│  ├─ pi-bridge/                        # Runs on Raspberry Pi (MQTT↔UART)
│  │  ├─ pyproject.toml
│  │  └─ bridge/
│  │     ├─ main.py                     # Sub MQTT, frame CBOR, send over UART
│  │     ├─ uart.py
│  │     └─ framing.py                  # SLIP-like framing + checksum
│  └─ mock-ui-cli/                      # Temporary CLI to simulate the UI
│     ├─ package.json
│     └─ src/
│        └─ index.ts
├─ firmware/
│  ├─ platformio.ini
│  ├─ lib/
│  │  ├─ CanFrame/
│  │  │  ├─ CanFrame.h
│  │  │  └─ CanFrame.cpp
│  │  └─ MsgPack/
│  │     ├─ Msg.h
│  │     └─ Msg.cpp
│  ├─ controller-mcu/                   # ESP32-S3 (UART↔CAN)
│  │  ├─ src/
│  │  │  └─ main.cpp
│  │  └─ include/
│  └─ cabinet-mcu/                      # ESP32-S3 (CAN + IO + sensors)
│     ├─ src/
│     │  └─ main.cpp
│     └─ include/
├─ shared/
│  ├─ schemas/                          # JSON/CBOR schemas with examples
│  │  ├─ mqtt/
│  │  │  ├─ dispense_request.schema.json
│  │  │  ├─ dispense_result.schema.json
│  │  │  ├─ heartbeat.schema.json
│  │  │  └─ sensor_update.schema.json
│  │  └─ can/
│  │     └─ id_format.md                # 11-bit layout + table
│  └─ proto/                            # (optional) for gRPC later
└─ tools/
   ├─ scripts/
   │  ├─ seed_tools.py
   │  └─ gen_test_data.py
   └─ git-templates/
      └─ commit-msg                     # Enforce Conventional Commits
```

---

## 🔐 Branching & Protection (GitHub)

1. **Default branch:** `main`.
2. **Branch naming:** `<your-name>/<type>-<short-desc>` e.g. `elhan/feat-dispense-flow`.
3. **Conventional Commits:** `feat:`, `fix:`, `docs:`, `refactor:`, etc.
4. **Require PR reviews:** At least **1** approval; disallow self-merge.
5. **Require up to date:** Rebase or merge from `main` before merge.

---

## 🧠 System Contracts (Topics, Payloads, CAN IDs)

### MQTT Topic Namespace (broker = Mosquitto)

* Commands from UI/backend → Controller:

  * **`shop/cmd/dispense`** (QoS1): request a dispense action
  * **`shop/cmd/cancel`** (QoS1)
* Controller/MCUs → Backend (events):

  * **`shop/evt/dispense_result`** (QoS1)
  * **`shop/evt/sensor_update`** (QoS0)
  * **`shop/evt/heartbeat`** (QoS0, retain last)
* Device state:

  * **`shop/state/controller`** (retain)
  * **`shop/state/cabinet/{cabinet_id}`** (retain)

> Payloads use **JSON** for human readability during dev; CBOR over **UART** and **CAN** for compactness on microcontrollers.

#### `dispense_request` (JSON)

```json
{
  "request_id": "uuid4",
  "student": { "ubc_card_uid": "hex", "student_id": "string" },
  "items": [ { "tool_id": "uuid", "qty": 1, "slot_id": "CAB01-S05" } ],
  "loan_days": 7,
  "limit_policy": { "max_tools": 3 },
  "requested_at": "2025-09-17T19:00:00Z"
}
```

#### `dispense_result` (JSON)

```json
{
  "request_id": "uuid4",
  "status": "OK | DENIED | PARTIAL | ERROR",
  "details": [ { "slot_id": "CAB01-S05", "result": "OK|JAM|EMPTY" } ],
  "controller_time": "2025-09-17T19:00:01Z"
}
```

#### `heartbeat` (JSON)

```json
{ "device": "controller|cabinet", "id": "CAB01", "ts": "2025-09-17T19:00:00Z", "uptime_s": 1234 }
```

> CBOR equivalents are produced/consumed by Pi Bridge (UART) and MCUs (CAN). See `shared/schemas/` for full drafts.

### CAN ID Layout (11-bit standard)

```
[10..9] Priority (2b)   00=high 01=med 10=low 11=dbg
[8..5]  MsgType  (4b)   0=HB 1=CMD 2=ACK 3=SENS 4=ERR ...
[4..0]  NodeID   (5b)   0=controller, 1..30=cabinets, 31=broadcast
```

**Examples:**

* Broadcast heartbeat from controller: `Prio=10, Type=HB=0x0, Node=0` → `0b10_0000_00000` = `0x200`
* Command to Cabinet #5: `Prio=01, Type=CMD=0x1, Node=0x05` → `0b01_0001_00101` = `0x125`

---

## 🧱 Database (Postgres) — Minimal Schema

`deploy/postgres/init.sql` seeds:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id TEXT UNIQUE NOT NULL,
  ubc_card_uid TEXT UNIQUE,
  name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  sku TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE inventory_slots (
  id TEXT PRIMARY KEY,              -- e.g., CAB01-S05
  cabinet_id TEXT NOT NULL,         -- e.g., CAB01
  tool_id UUID REFERENCES tools(id),
  capacity INT NOT NULL DEFAULT 1,
  qty INT NOT NULL DEFAULT 0,
  sensor_type TEXT,                 -- ir, weight, switch
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES students(id),
  tool_id UUID REFERENCES tools(id),
  slot_id TEXT REFERENCES inventory_slots(id),
  qty INT NOT NULL,
  requested_at TIMESTAMPTZ DEFAULT now(),
  due_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ
);

CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,               -- dispense_result, sensor_update, heartbeat
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Limits view (example): how many active loans per student
CREATE VIEW active_loan_counts AS
SELECT student_id, COUNT(*) AS active
FROM loans WHERE returned_at IS NULL
GROUP BY student_id;
```

---

## 🐋 Dev Stack (Docker Compose)

`deploy/docker-compose.yml`

```yaml
version: "3.9"
services:
  mqtt:
    image: eclipse-mosquitto:2
    ports: ["1883:1883", "9001:9001"]
    volumes:
      - ./mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf
      - ./mosquitto/aclfile:/mosquitto/config/aclfile
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_USER: postgres
      POSTGRES_DB: shop
    ports: ["5432:5432"]
    volumes:
      - dbdata:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
  adminer:
    image: adminer
    ports: ["8080:8080"]
  backend:
    build: ../services/backend-fastapi
    env_file: ../env/.env
    depends_on: [mqtt, db]
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    ports: ["8000:8000"]
volumes:
  dbdata:
```

`deploy/mosquitto/mosquitto.conf`

```conf
listener 1883 0.0.0.0
allow_anonymous true
persistence true
```

---

## 🧩 Backend (FastAPI) — MQTT↔DB glue

`services/backend-fastapi/app/schemas.py`

```python
from pydantic import BaseModel, Field
from typing import List, Literal, Optional
import uuid

class Student(BaseModel):
    ubc_card_uid: str
    student_id: str

class DispenseItem(BaseModel):
    tool_id: str
    qty: int = 1
    slot_id: str

class DispenseRequest(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    student: Student
    items: List[DispenseItem]
    loan_days: int = 7
    limit_policy: dict = {"max_tools": 3}

class DispenseDetail(BaseModel):
    slot_id: str
    result: Literal["OK", "JAM", "EMPTY", "DENIED", "ERROR"]

class DispenseResult(BaseModel):
    request_id: str
    status: Literal["OK", "DENIED", "PARTIAL", "ERROR"]
    details: List[DispenseDetail]
```

`services/backend-fastapi/app/main.py`

```python
from fastapi import FastAPI, Depends
from app.schemas import DispenseRequest
from app.mqtt_handlers import publish_dispense

app = FastAPI(title="Shop Assistant Backend")

@app.post("/api/dispense")
def create_dispense(req: DispenseRequest):
    # TODO: validate limits against DB
    publish_dispense(req)
    return {"ok": True, "request_id": req.request_id}
```

`services/backend-fastapi/app/mqtt_handlers.py`

```python
import json, os
import paho.mqtt.client as mqtt
from app.schemas import DispenseRequest

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
TOPIC_CMD_DISPENSE = "shop/cmd/dispense"

_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
_client.connect(MQTT_HOST, 1883, 60)

def publish_dispense(req: DispenseRequest):
    _client.publish(TOPIC_CMD_DISPENSE, json.dumps(req.model_dump()), qos=1)
```

---

## 🔗 Pi Bridge (MQTT↔UART, CBOR framing)

`services/pi-bridge/bridge/framing.py`

```python
import cbor2, zlib

START = b"\xC0"  # SLIP-like sentinel

def encode_frame(obj: dict) -> bytes:
    payload = cbor2.dumps(obj)
    crc = zlib.crc32(payload) & 0xFFFFFFFF
    body = payload + crc.to_bytes(4, "big")
    return START + body + START

def decode_frames(buf: bytes):
    # naive splitter for demo
    parts = buf.split(START)
    for i in range(1, len(parts)-1):
        body = parts[i]
        payload, crc = body[:-4], int.from_bytes(body[-4:], "big")
        if zlib.crc32(payload) & 0xFFFFFFFF == crc:
            yield cbor2.loads(payload)
```

`services/pi-bridge/bridge/main.py`

```python
import json, os, serial, threading
import paho.mqtt.client as mqtt
from .framing import encode_frame, decode_frames

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
UART_PORT = os.getenv("UART_PORT", "/dev/ttyUSB0")
UART_BAUD = int(os.getenv("UART_BAUD", "115200"))

TOPIC_CMD_DISPENSE = "shop/cmd/dispense"
TOPIC_EVT_RESULT   = "shop/evt/dispense_result"

ser = serial.Serial(UART_PORT, UART_BAUD, timeout=0.1)
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.connect(MQTT_HOST, 1883, 60)

# MQTT→UART
def on_message(_c, _ud, msg):
    if msg.topic == TOPIC_CMD_DISPENSE:
        payload = json.loads(msg.payload)
        frame = encode_frame({"t":"DISPENSE", "d": payload})
        ser.write(frame)

client.on_message = on_message
client.subscribe([(TOPIC_CMD_DISPENSE, 1)])
client.loop_start()

# UART→MQTT (controller responses)
rx_buf = bytearray()

def uart_rx_loop():
    while True:
        rx = ser.read(512)
        if rx:
            rx_buf.extend(rx)
            for obj in decode_frames(bytes(rx_buf)):
                if obj.get("t") == "DISPENSE_RESULT":
                    client.publish(TOPIC_EVT_RESULT, json.dumps(obj["d"]))
            # simple: clear buffer on parse attempt
            rx_buf.clear()

threading.Thread(target=uart_rx_loop, daemon=True).start()

print("Pi Bridge running.")
```

---

## 🔧 Firmware — Controller MCU (ESP32-S3, UART↔CAN)

`firmware/platformio.ini`

```ini
[env:esp32s3]
platform = espressif32 @ 6.6.0
board = esp32-s3-devkitc-1
framework = arduino
monitor_speed = 115200
lib_deps =
  adafruit/Adafruit MCP2515 @ ^1.1.0   ; example CAN via MCP2515 if using external transceiver
  bblanchon/ArduinoJson @ ^7
```

`firmware/lib/CanFrame/CanFrame.h`

```cpp
#pragma once
#include <Arduino.h>
struct CanMsg { uint16_t id; uint8_t len; uint8_t data[8]; };
uint16_t makeId(uint8_t prio, uint8_t type, uint8_t node);
```

`firmware/lib/CanFrame/CanFrame.cpp`

```cpp
#include "CanFrame.h"
uint16_t makeId(uint8_t prio, uint8_t type, uint8_t node){
  return ((prio & 0x3) << 9) | ((type & 0xF) << 5) | (node & 0x1F);
}
```

`firmware/controller-mcu/src/main.cpp`

```cpp
#include <Arduino.h>
#include <ArduinoJson.h>
#include "CanFrame.h"

// TODO: init CAN driver (MCP2515 or built-in TWAI for ESP32)

static String rxBuf;

void sendDispenseToCabinet(const JsonObject& req){
  // naive: send one frame per item to its cabinet node
  for (JsonObject item : req["items"].as<JsonArray>()){
    String slot = item["slot_id"].as<String>(); // e.g., CAB01-S05
    uint8_t cabinet = (uint8_t) slot.substring(3,5).toInt(); // "01" -> 1
    uint8_t node = cabinet; // node id mapping

    uint16_t id = makeId(1, /*CMD*/1, node);
    uint8_t data[8] = { 'D','S','P', (uint8_t)item["qty"].as<int>(), 0,0,0,0 };
    // TODO: pack better (CBOR/msgpack)
    // canSend({ .id=id, .len=8, .data={...}});
  }
}

void setup(){
  Serial.begin(115200);
  // canInit();
}

void loop(){
  while (Serial.available()){
    char c = (char)Serial.read();
    rxBuf += c;
    if (c == '\xC0'){
      // demo: parse very simply assuming one JSON frame between 0xC0 sentinels
      int s = rxBuf.indexOf('\xC0');
      int e = rxBuf.lastIndexOf('\xC0');
      if (e > s){
        String body = rxBuf.substring(s+1, e);
        StaticJsonDocument<1024> doc;
        if (deserializeJson(doc, body) == DeserializationError::Ok){
          const char* t = doc["t"];
          if (strcmp(t, "DISPENSE") == 0){
            JsonObject d = doc["d"].as<JsonObject>();
            sendDispenseToCabinet(d);
            // respond minimal result
            StaticJsonDocument<256> res;
            res["t"] = "DISPENSE_RESULT";
            JsonObject dd = res.createNestedObject("d");
            dd["request_id"] = d["request_id"].as<const char*>();
            dd["status"] = "OK";
            serializeJson(res, Serial);
            Serial.write('\xC0');
          }
        }
        rxBuf = "";
      }
    }
  }
  // TODO: forward CAN sensor/heartbeat upstream periodically
}
```

---

## 🔩 Firmware — Cabinet MCU (ESP32-S3, CAN + IO)

`firmware/cabinet-mcu/src/main.cpp`

```cpp
#include <Arduino.h>
#include "CanFrame.h"

const int SOLENOID_PIN = 10; // example
const int IR_PIN = 4;        // example
uint8_t NODE_ID = 1;         // set uniquely per cabinet

void setup(){
  pinMode(SOLENOID_PIN, OUTPUT);
  pinMode(IR_PIN, INPUT_PULLUP);
  // canInit(node=NODE_ID)
}

void loop(){
  // if (canAvailable()){
  //   CanMsg m = canRead();
  //   uint8_t type = (m.id >> 5) & 0xF;
  //   if (type == 1 /*CMD*/){
  //     // naive: data[0..2] == 'D','S','P'
  //     digitalWrite(SOLENOID_PIN, HIGH);
  //     delay(500);
  //     digitalWrite(SOLENOID_PIN, LOW);
  //   }
  // }

  // heartbeat every 2s (pseudo)
  // static uint32_t last=0; if (millis()-last>2000){ sendHB(); last=millis(); }
}
```

---

## 🧪 Mock UI (CLI) — temporary student/admin flows

`services/mock-ui-cli/src/index.ts`

```ts
import mqtt from 'mqtt';
import { randomUUID } from 'crypto';

const client = mqtt.connect('mqtt://localhost:1883');

function sendDispense(studentId: string, cardUid: string, slotId: string, toolId: string){
  const payload = {
    request_id: randomUUID(),
    student: { student_id: studentId, ubc_card_uid: cardUid },
    items: [{ tool_id: toolId, qty: 1, slot_id: slotId }],
    loan_days: 7,
    limit_policy: { max_tools: 3 }
  };
  client.publish('shop/cmd/dispense', JSON.stringify(payload), { qos: 1 });
  console.log('sent dispense', payload);
}

client.on('connect', () => {
  console.log('CLI connected to MQTT');
  sendDispense('s12345678', 'ABCD1234', 'CAB01-S05', 'tool-uuid-1');
});

client.on('message', (t, m) => console.log('evt', t, m.toString()));
client.subscribe('shop/evt/#');
```

---

## 🪪 Card Scanning (abstracted)

On Pi, you can plug a USB NFC reader (ACR122U). Add a `card-reader` module later; for now we provide an **interface** and a **mock** used by the CLI or UI.

Interface (Python):

```python
# services/backend-fastapi/app/card_reader.py
from typing import Optional
class CardReader:
    def get_uid(self) -> Optional[str]:
        """Return hex UID if a card is present else None."""
        raise NotImplementedError

class MockCardReader(CardReader):
    def __init__(self, fixed_uid: str = "ABCD1234"): self.fixed = fixed_uid
    def get_uid(self) -> Optional[str]: return self.fixed
```

---

## 🧭 E2E Flow (What talks to what?)

1. **Student/Admin UI** (web or touchscreen) calls **`POST /api/dispense`** with tool list + card UID.
2. **Backend** validates limits (DB), then publishes **`shop/cmd/dispense`** (JSON).
3. **Pi Bridge** subscribes; converts JSON→CBOR, frames, sends over **UART** to **Controller MCU**.
4. **Controller** parses, maps items → target **Cabinet NodeIDs**, pushes **CMD** frames on **CAN**.
5. **Cabinet MCU** executes (opens solenoid, etc.), optionally reads **IR** to confirm removal, replies via **ACK/SENS**.
6. **Controller** aggregates results → emits **DISPENSE\_RESULT** back over **UART**.
7. **Pi Bridge** publishes **`shop/evt/dispense_result`** (JSON) to MQTT.
8. **Backend** records event & creates **loan** rows (due date = now + loan\_days). Admin notifications (later).

---

## 🚀 Quickstart (Dev)

```bash
# 0) Clone & setup
cp env/.env.example .env
pre-commit install

# 1) Infra
cd deploy && docker compose up -d  # mqtt, postgres, adminer, backend

# 2) Mock UI (simulates student flow)
cd services/mock-ui-cli && npm i && npm run start

# 3) Pi Bridge (if you have a USB-Serial to controller)
cd services/pi-bridge && uv sync && UV_HTTP_TIMEOUT=60 python -m bridge.main
# (set UART_PORT in .env)

# 4) Firmware
# Open `firmware/` in VSCode + PlatformIO, flash controller & a cabinet
```

---

## ✅ Contribution Rules (TL;DR)

* Branch from `main` → name it like `elhan/feat-can-heartbeat`.
* Small PRs with checklists.
* Update `docs/` if you change comms or schemas.
* Add tests where possible (unit tests for handlers, framing, id pack/unpack).
* Keep **topics** and **CAN IDs** in sync with `docs/comms-topology.md`.

---

## 📄 Appendix — Samples & Stubs

**`shared/schemas/mqtt/heartbeat.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ubc.example/schemas/heartbeat.json",
  "type": "object",
  "properties": {
    "device": {"enum": ["controller", "cabinet"]},
    "id": {"type": "string"},
    "ts": {"type": "string", "format": "date-time"},
    "uptime_s": {"type": "integer", "minimum": 0}
  },
  "required": ["device", "id", "ts", "uptime_s"]
}
```

**`docs/comms-topology.md`**

```md
# Comms Topology

- UART framing: SLIP-like 0xC0 sentinels, CBOR payload + CRC32.
- CAN: 11-bit IDs (prio|type|node). Data: small msgpack/CBOR blobs.
- Heartbeat: controller every 2s (broadcast), cabinet every 5s.
- Timeouts: dispense op must return within 5s else mark PARTIAL.
```

---

## 🧯 Troubleshooting Cheats

* Nothing on MQTT? `mosquitto_sub -t '#' -v -h localhost`
* UART garbage? Check baud and USB device; ensure `C0` framing matches both sides.
* CAN silent? Verify 120Ω termination at bus ends and common GND.
* DB empty? Open Adminer at [http://localhost:8080](http://localhost:8080) and confirm `tools` seeded.

---

## 📌 Roadmap to v2

* Real NFC reader module (ACR122U) integration on Pi.
* Policy engine for loan limits and overdue alerts.
* Proper CAN driver config (TWAI) and message packing.
* Migrate JSON payloads to CBOR end‑to‑end when UI tooling ready.
* Web UI (Next.js) for Admin/Student dashboards.

```
```
