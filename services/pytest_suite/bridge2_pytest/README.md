# bridge2-specific pytest suite

This test bundle targets the refactored `bridge2.py` orchestration layer.

## What it covers
- SIM-mode command handling
- deduplication behavior
- dispense and return orchestration in Moonraker mode
- busy-machine rejection
- encoder-confirmed rotation
- admin manual, machine, and calibration actions
- alert and machine-status publishing

## Expected layout
Preferred layout inside your backend repo:

- `backend/tests_bridge2/conftest.py`
- `backend/tests_bridge2/test_bridge2_core.py`
- `backend/tests_bridge2/test_bridge2_admin.py`
- `backend/tests_bridge2/test_bridge2_sim.py`

You can also keep the files anywhere and point the loader at your module path with:

```bash
export BRIDGE2_PATH=/absolute/path/to/backend/app/bridge2.py
pytest -q
```

If your module is importable as `app.bridge2`, no extra setup is needed.

## Notes
These tests use fakes and monkeypatching only. They do not require a live MQTT broker, Moonraker instance, or serial hardware.
