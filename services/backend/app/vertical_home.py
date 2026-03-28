from __future__ import annotations

import os
import sys
import time
from typing import Dict, Any

import requests

MOONRAKER_URL = os.getenv("MOONRAKER_URL", "http://localhost:7125").rstrip("/")
TIMEOUT_S = float(os.getenv("MOONRAKER_TIMEOUT_S", "10"))
SETTLE_DELAY_S = float(os.getenv("VERTICAL_HOME_SETTLE_DELAY_S", "0.05"))

# Raw step-units / microstep-units
HOME_START_UNITS = int(os.getenv("VERTICAL_HOME_START_UNITS", "800000"))
JOG_STEP_UNITS = int(os.getenv("VERTICAL_HOME_JOG_STEP_UNITS", "1600"))
MAX_ITERS = int(os.getenv("VERTICAL_HOME_MAX_ITERS", "1000"))

LEFT_STEPPER = os.getenv("VERTICAL_LEFT_STEPPER", "gantry1")
RIGHT_STEPPER = os.getenv("VERTICAL_RIGHT_STEPPER", "gantry2")

LEFT_ENDSTOP_NAME = os.getenv("VERTICAL_LEFT_ENDSTOP_NAME", "manual_stepper gantry1").strip().lower()
RIGHT_ENDSTOP_NAME = os.getenv("VERTICAL_RIGHT_ENDSTOP_NAME", "manual_stepper gantry2").strip().lower()

session = requests.Session()


def log(msg: str) -> None:
    print(msg, flush=True)


def get_printer_info() -> Dict[str, Any]:
    r = session.get(f"{MOONRAKER_URL}/printer/info", timeout=TIMEOUT_S)
    r.raise_for_status()
    payload = r.json()
    return payload.get("result", payload)


def assert_printer_ready() -> None:
    info = get_printer_info()
    state = str(info.get("state", "")).lower()
    if state != "ready":
        raise RuntimeError(
            f"Printer not ready: state={state}\n{info.get('state_message', '')}"
        )


def send_script(lines: list[str] | str) -> Dict[str, Any]:
    script = lines if isinstance(lines, str) else "\n".join(lines)
    log(f"[GCODE]\n{script}")
    r = session.post(
        f"{MOONRAKER_URL}/printer/gcode/script",
        json={"script": script},
        timeout=TIMEOUT_S,
    )
    try:
        r.raise_for_status()
    except requests.HTTPError:
        raise RuntimeError(f"G-code request failed:\nstatus={r.status_code}\nbody={r.text}") from None
    payload = r.json()
    return payload.get("result", payload)


def query_endstops_raw() -> Dict[str, str]:
    r = session.get(
        f"{MOONRAKER_URL}/printer/query_endstops/status",
        timeout=TIMEOUT_S,
    )
    r.raise_for_status()
    payload = r.json()
    return payload.get("result", payload)


def normalize_endstops(status: Dict[str, Any]) -> Dict[str, str]:
    return {str(k).strip().lower(): str(v).strip().lower() for k, v in status.items()}


def is_triggered(value: str) -> bool:
    return value == "triggered"


def get_hit_flags() -> tuple[bool, bool, Dict[str, str]]:
    raw = query_endstops_raw()
    norm = normalize_endstops(raw)

    left_hit = is_triggered(norm.get(LEFT_ENDSTOP_NAME, "open"))
    right_hit = is_triggered(norm.get(RIGHT_ENDSTOP_NAME, "open"))

    return left_hit, right_hit, norm


def pretty_status(status: Dict[str, str]) -> str:
    return ", ".join(f"{k}={v}" for k, v in sorted(status.items()))


def enable_verticals() -> None:
    send_script([
        f"MANUAL_STEPPER STEPPER={LEFT_STEPPER} ENABLE=1",
        f"MANUAL_STEPPER STEPPER={RIGHT_STEPPER} ENABLE=1",
    ])


def set_vertical_positions(left_pos: int, right_pos: int) -> None:
    send_script([
        f"MANUAL_STEPPER STEPPER={LEFT_STEPPER} SET_POSITION={left_pos}",
        f"MANUAL_STEPPER STEPPER={RIGHT_STEPPER} SET_POSITION={right_pos}",
    ])


def jog_toward_home(left_pos: int | None, right_pos: int | None) -> None:
    lines: list[str] = []

    if left_pos is not None:
        lines.append(
            f"MANUAL_STEPPER STEPPER={LEFT_STEPPER} MOVE={left_pos} STOP_ON_ENDSTOP=try_probe"
        )
    if right_pos is not None:
        lines.append(
            f"MANUAL_STEPPER STEPPER={RIGHT_STEPPER} MOVE={right_pos} STOP_ON_ENDSTOP=try_probe"
        )

    if lines:
        send_script(lines)


def finalize_home() -> None:
    send_script([
        "MANUAL_STEPPER STEPPER=gantry1 SET_POSITION=0",
        "MANUAL_STEPPER STEPPER=gantry2 SET_POSITION=0",
        "SET_GCODE_VARIABLE MACRO=SA_STATE VARIABLE=z_pos VALUE=0",
        "SET_GCODE_VARIABLE MACRO=SA_STATE VARIABLE=homed VALUE=1",
        "SA_STATUS",
    ])


def home_vertical_python_assisted() -> None:
    assert_printer_ready()

    log("[INFO] Enabling gantry steppers")
    enable_verticals()

    log(f"[INFO] Setting initial vertical positions to {HOME_START_UNITS}")
    left_pos = HOME_START_UNITS
    right_pos = HOME_START_UNITS
    set_vertical_positions(left_pos, right_pos)

    left_hit, right_hit, status = get_hit_flags()
    log(f"[INIT ENDSTOPS] {pretty_status(status)}")

    if left_hit and right_hit:
        log("[INFO] Both endstops already triggered before motion")
        finalize_home()
        return

    for i in range(1, MAX_ITERS + 1):
        next_left = None if left_hit else left_pos - JOG_STEP_UNITS
        next_right = None if right_hit else right_pos - JOG_STEP_UNITS

        jog_toward_home(next_left, next_right)

        if next_left is not None:
            left_pos = next_left
        if next_right is not None:
            right_pos = next_right

        if SETTLE_DELAY_S > 0:
            time.sleep(SETTLE_DELAY_S)

        left_hit, right_hit, status = get_hit_flags()

        log(
            f"[ITER {i:04d}] "
            f"left_pos={left_pos} right_pos={right_pos} "
            f"left_hit={left_hit} right_hit={right_hit} | "
            f"{pretty_status(status)}"
        )

        if left_hit and right_hit:
            log("[INFO] Both vertical endstops triggered")
            finalize_home()
            return

    raise RuntimeError(
        f"Vertical homing exceeded max iterations ({MAX_ITERS}). "
        f"Last positions: left={left_pos}, right={right_pos}, "
        f"left_hit={left_hit}, right_hit={right_hit}"
    )


if __name__ == "__main__":
    try:
        home_vertical_python_assisted()
    except KeyboardInterrupt:
        log("[INTERRUPTED]")
        sys.exit(130)
    except Exception as e:
        log(f"[ERROR] {e}")
        sys.exit(1)