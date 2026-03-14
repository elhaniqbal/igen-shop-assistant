# backend/db_migrations.py
from __future__ import annotations

import os
import sqlite3


def _sqlite_path_from_database_url() -> str | None:
    """
    Mirrors your db.py:
      DATABASE_URL default: sqlite:///./data/igen.db
    Returns an absolute filesystem path to the sqlite file, or None if not sqlite.
    """
    database_url = os.getenv("DATABASE_URL", "sqlite:///./data/igen.db").strip()

    if not database_url.startswith("sqlite"):
        return None

    # Handle:
    #   sqlite:///./data/igen.db   -> ./data/igen.db
    #   sqlite:////app/data/igen.db -> /app/data/igen.db
    #   sqlite:///data/igen.db     -> /data/igen.db
    if database_url.startswith("sqlite:////"):
        path = database_url.replace("sqlite:////", "/", 1)
    elif database_url.startswith("sqlite:///"):
        path = database_url.replace("sqlite:///", "", 1)
    else:
        # e.g. sqlite:// (rare) or sqlite:relative.db
        path = database_url.replace("sqlite:", "", 1)

    # Resolve relative paths exactly like your engine does (relative to cwd)
    if not os.path.isabs(path):
        path = os.path.abspath(path)

    return path


def _cols(conn: sqlite3.Connection, table: str) -> set[str]:
    cur = conn.execute(f"PRAGMA table_info({table});")
    return {row[1] for row in cur.fetchall()}


def ensure_tool_model_policy_columns() -> None:
    """
    Adds policy columns to tool_models if missing.
    Safe to run multiple times on SQLite.

    Columns:
      - max_loan_hours INTEGER
      - max_qty_per_user INTEGER
    """
    path = _sqlite_path_from_database_url()
    if not path:
        print("[MIGRATIONS] non-sqlite DB; skipping tool_model policy columns migration")
        return

    # If DB file not there yet, init_db() will create it. Don't brick startup.
    if not os.path.exists(path):
        print(f"[MIGRATIONS] sqlite file not found yet: {path} (skipping)")
        return

    conn = sqlite3.connect(path)
    try:
        existing = _cols(conn, "tool_models")

        if "max_loan_hours" not in existing:
            conn.execute("ALTER TABLE tool_models ADD COLUMN max_loan_hours INTEGER;")
            print("[MIGRATIONS] added tool_models.max_loan_hours")

        if "max_qty_per_user" not in existing:
            conn.execute("ALTER TABLE tool_models ADD COLUMN max_qty_per_user INTEGER;")
            print("[MIGRATIONS] added tool_models.max_qty_per_user")

        conn.commit()
    finally:
        conn.close()
