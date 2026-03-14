# IGEN Shop Assistant - HAVEN

Smart tool dispensing and return system using RFID, MQTT, and distributed embedded controllers.

---

## 1. High-Level Overview

The system consists of:

- **Frontend (React)** – kiosk UI for users and admins
- **Backend (FastAPI)** – business logic, DB, orchestration
- **MQTT Broker (Mosquitto)** – async messaging backbone
- **Bridge Sidecar** – MQTT ↔ Serial (ESP32)
- **RFID Sidecar** – MFRC522 reader → MQTT
- **Hardware** – ESP32 master + gantry & cake slave MCUs

All hardware interaction is **event-driven** via MQTT.

---
