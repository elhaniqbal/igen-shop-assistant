from __future__ import annotations

import importlib
import importlib.util
import json
import os
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest



def _load_bridge2_module():
    candidates = ["app.bridge2", "bridge2"]
    for name in candidates:
        try:
            return importlib.import_module(name)
        except ModuleNotFoundError:
            pass

    env_path = os.getenv("BRIDGE2_PATH")
    if env_path:
        p = Path(env_path)
        if not p.exists():
            raise FileNotFoundError(f"BRIDGE2_PATH does not exist: {p}")
        spec = importlib.util.spec_from_file_location("bridge2_under_test", p)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    default_paths = [
        Path.cwd() / "app" / "bridge2.py",
        Path.cwd() / "bridge2.py",
    ]
    for p in default_paths:
        if p.exists():
            spec = importlib.util.spec_from_file_location("bridge2_under_test", p)
            assert spec and spec.loader
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module

    raise RuntimeError(
        "Could not import bridge2 module. Try setting BRIDGE2_PATH to backend/app/bridge2.py"
    )


@pytest.fixture(scope="session")
def bridge2_mod():
    return _load_bridge2_module()


class FakeMQTTClient:
    def __init__(self, *args, **kwargs):
        self.on_connect = None
        self.on_message = None
        self.published: list[tuple[str, dict[str, Any], int]] = []
        self.subscriptions: list[tuple[str, int]] = []
        self.connected = None
        self.loop_started = False
        self.disconnected = False

    def connect(self, host, port, keepalive):
        self.connected = (host, port, keepalive)

    def loop_start(self):
        self.loop_started = True

    def loop_stop(self):
        self.loop_started = False

    def disconnect(self):
        self.disconnected = True

    def subscribe(self, topic, qos=0):
        self.subscriptions.append((topic, qos))

    def publish(self, topic, payload, qos=0):
        parsed = json.loads(payload) if isinstance(payload, str) else payload
        self.published.append((topic, parsed, qos))
        return SimpleNamespace(rc=0)


class FakeMoonraker:
    def __init__(self):
        self.server_info_calls = 0
        self.status_calls = 0
        self.sent_gcodes: list[str] = []
        self.restart_calls: list[str] = []
        self.emergency_stop_calls = 0
        self.firmware_restart_calls = 0
        self.wait_calls: list[tuple[float, float]] = []
        self.status_payload = {
            "result": {
                "status": {
                    "toolhead": {"homed_axes": "xyz", "position": [1.0, 2.0, 3.0, 4.0]},
                    "idle_timeout": {"state": "Idle"},
                    "print_stats": {"state": "standby", "message": "ok"},
                }
            }
        }

    def get_server_info(self):
        self.server_info_calls += 1
        return {"result": {"klippy_connected": True}}

    def get_printer_status(self):
        self.status_calls += 1
        return self.status_payload

    def send_gcode(self, script: str):
        self.sent_gcodes.append(script)
        return {"result": "ok"}

    def restart_service(self, service: str = "klipper"):
        self.restart_calls.append(service)
        return {"result": "ok"}

    def emergency_stop(self):
        self.emergency_stop_calls += 1
        return {"result": "ok"}

    def firmware_restart(self):
        self.firmware_restart_calls += 1
        return {"result": "ok"}

    def wait_until_idle(self, timeout_s: float, poll_interval_s: float = 0.35):
        self.wait_calls.append((timeout_s, poll_interval_s))
        return self.status_payload


class FakeEncoder:
    def __init__(self, reads=None):
        self._reads = list(reads or [])
        self.read_calls: list[int] = []
        self.zero_calls: list[int] = []
        self.set_zero_calls: list[tuple[int, float]] = []
        self.clear_zero_calls: list[int] = []
        self.status_calls = 0

    def read_angle(self, cake_id: int) -> float:
        self.read_calls.append(cake_id)
        if not self._reads:
            raise AssertionError("No more fake encoder readings configured")
        return float(self._reads.pop(0))

    def zero(self, cake_id: int):
        self.zero_calls.append(cake_id)
        return "OK ZERO"

    def set_zero(self, cake_id: int, deg: float):
        self.set_zero_calls.append((cake_id, deg))
        return "OK SETZERO"

    def clear_zero(self, cake_id: int):
        self.clear_zero_calls.append(cake_id)
        return "OK CLEARZERO"

    def status(self):
        self.status_calls += 1
        return "OK STATUS"


@dataclass
class BuiltBridge:
    bridge: Any
    mqtt: FakeMQTTClient
    moonraker: FakeMoonraker
    encoder: FakeEncoder | None
    mod: Any


@pytest.fixture()
def make_bridge(monkeypatch, bridge2_mod):
    def _build(*, mode="MOONRAKER", encoder=None, wait_idle=False, encoder_confirm=False):
        monkeypatch.setattr(bridge2_mod.mqtt, "Client", FakeMQTTClient)
        monkeypatch.setattr(bridge2_mod, "WAIT_IDLE", wait_idle)
        monkeypatch.setattr(bridge2_mod, "ENCODER_CONFIRM_ENABLED", encoder_confirm)
        cfg = bridge2_mod.BridgeConfig(
            mode=mode,
            moonraker_url="http://moonraker.test",
            ack_timeout_ms=500,
            done_timeout_ms=30000,
        )
        bridge = bridge2_mod.Bridge2(cfg)
        mqtt = bridge.client
        moon = FakeMoonraker()
        bridge.moonraker = moon
        bridge.encoder = encoder
        bridge._dispatch_async = lambda target, *args: target(*args)
        return BuiltBridge(bridge=bridge, mqtt=mqtt, moonraker=moon, encoder=encoder, mod=bridge2_mod)

    return _build


@pytest.fixture()
def published_topics():
    def _extract(fake_mqtt: FakeMQTTClient, topic: str):
        return [payload for t, payload, _ in fake_mqtt.published if t == topic]

    return _extract
