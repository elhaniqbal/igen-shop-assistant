from __future__ import annotations

import json
import os
import time
from urllib import error, request

MOONRAKER_URL = os.getenv("MOONRAKER_URL", "http://host.docker.internal:7125").rstrip("/")
STEP_MM = float(os.getenv("VERTICAL_HOME_JOG_STEP_MM", "5"))
DWELL_S = float(os.getenv("VERTICAL_HOME_DWELL_S", "0.1"))
MAX_ITERS = int(os.getenv("VERTICAL_HOME_MAX_ITERS", "300"))


def _post_gcode(script: str) -> dict:
    req = request.Request(
        f"{MOONRAKER_URL}/printer/gcode/script",
        data=json.dumps({"script": script}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=5) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _query_endstops() -> dict:
    out = _post_gcode("QUERY_ENDSTOPS")
    return out.get("result", {})


def _endstop_hit(state: dict, name: str) -> bool:
    blob = state.get("status") or state.get("last_query") or state
    if isinstance(blob, dict):
        return bool(blob.get(name))
    return False


def _stop_stepper(name: str):
    _post_gcode(f"MANUAL_STEPPER STEPPER={name} MOVE=0 STOP_ON_ENDSTOP=0")


def _jog_both_down(step_mm: float):
    _post_gcode(f"MANUAL_STEPPER STEPPER=gantry1 MOVE=-{step_mm}")
    _post_gcode(f"MANUAL_STEPPER STEPPER=gantry2 MOVE=-{step_mm}")


def home_vertical_python_assisted():
    _post_gcode("MANUAL_STEPPER STEPPER=gantry1 ENABLE=1")
    _post_gcode("MANUAL_STEPPER STEPPER=gantry2 ENABLE=1")

    hit_left = False
    hit_right = False

    for _ in range(MAX_ITERS):
        _jog_both_down(STEP_MM)
        time.sleep(DWELL_S)
        state = _query_endstops()

        if _endstop_hit(state, "gantry1"):
            hit_left = True
            _stop_stepper("gantry1")
        if _endstop_hit(state, "gantry2"):
            hit_right = True
            _stop_stepper("gantry2")

        if hit_left and hit_right:
            _post_gcode("MANUAL_STEPPER STEPPER=gantry1 SET_POSITION=0")
            _post_gcode("MANUAL_STEPPER STEPPER=gantry2 SET_POSITION=0")
            return

    raise RuntimeError("vertical homing exceeded max iterations")


if __name__ == "__main__":
    home_vertical_python_assisted()
