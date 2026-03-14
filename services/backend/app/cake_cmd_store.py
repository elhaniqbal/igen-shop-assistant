from __future__ import annotations
from typing import Optional, Dict, Any
import threading

_lock = threading.Lock()
_store: Dict[str, Dict[str, Any]] = {}

def set_cake_cmd_status(request_id: str, patch: dict):
    with _lock:
        cur = _store.get(request_id, {"request_id": request_id})
        cur.update(patch)
        _store[request_id] = cur

def get_cake_cmd_status(request_id: str) -> Optional[dict]:
    with _lock:
        v = _store.get(request_id)
        return dict(v) if v else None
