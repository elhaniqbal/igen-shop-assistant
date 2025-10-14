import os, time, threading
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from paho.mqtt.client import Client as MqttClient
from sqlalchemy import text
from .db import SessionLocal, init as db_init

MQTT_HOST = os.getenv("MQTT_HOST", "mqtt")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPICS = ["rfid/scan", "dispense", "return"]

_state = {"ready": False, "tag": None}
_lock = threading.Lock()

# ---------------- MQTT logic ----------------
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[MQTT] ✅ Connected")
        for t in MQTT_TOPICS:
            client.subscribe(t, qos=1)
    else:
        print(f"[MQTT] ❌ Connect rc={rc}")

def on_message(client, userdata, msg):
    topic = msg.topic
    payload = msg.payload.decode()
    print(f"[MQTT] {topic} → {payload}")

    try:
        with SessionLocal() as s, s.begin():
            s.execute(
                text("INSERT INTO events(topic, payload) VALUES (:t, :p)"),
                {"t": topic, "p": payload},
            )
    except Exception as e:
        print(f"[DB] ⚠️ Insert failed: {e}")

    if topic == "rfid/scan":
        with _lock:
            _state["ready"] = True
            _state["tag"] = payload

def start_mqtt():
    client = MqttClient()
    client.on_connect = on_connect
    client.on_message = on_message
    for i in range(10):
        try:
            client.connect(MQTT_HOST, MQTT_PORT, 60)
            client.loop_start()
            print("[MQTT] ✅ Loop started")
            return client
        except Exception as e:
            print(f"[MQTT] Retry {i+1}: {e}")
            time.sleep(3)
    print("[MQTT] ⚠️ Gave up after 10 tries")
    return None

# ---------------- Lifespan ----------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[APP] Startup")
    db_init()
    mqtt = start_mqtt()
    try:
        yield
    finally:
        print("[APP] Shutdown")
        if mqtt:
            mqtt.loop_stop()
            mqtt.disconnect()

app = FastAPI(title="IGEN Shop Assistant API", lifespan=lifespan)

# ---------------- Routes ----------------
@app.get("/api/healthz", response_class=PlainTextResponse)
def healthz(): return "ok"

@app.get("/api/ping", response_class=PlainTextResponse)
def ping(): return "pong"

@app.get("/api/auth/status")
def auth_status():
    with _lock:
        return {"ready": _state["ready"], "tag": _state["tag"]}

@app.post("/api/simulate-scan", response_class=PlainTextResponse)
def simulate_scan():
    fake = type("Msg", (), {"topic": "rfid/scan", "payload": b"SIM-TEST"})
    on_message(None, None, fake)
    return "simulated\n"
