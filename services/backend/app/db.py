import os
import sqlite3
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DB_PATH = os.getenv("DATABASE_URL", "sqlite:///./data/local_cache.db")
engine = create_engine(DB_PATH, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine)

def init():
    """Ensure the events table exists and matches expected schema."""
    os.makedirs("./data", exist_ok=True)

    with engine.begin() as conn:
        conn.execute(
            text("""
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              topic TEXT NOT NULL,
              payload TEXT NOT NULL,
              ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """)
        )

        # optional sanity check: if missing columns (old schema), drop+recreate
        cols = [
            r[1]
            for r in conn.exec_driver_sql("PRAGMA table_info(events)").fetchall()
        ]
        if set(cols) != {"id", "topic", "payload", "ts"}:
            print("[DB] ⚠️ Schema mismatch, recreating events table...")
            conn.execute(text("DROP TABLE IF EXISTS events"))
            conn.execute(
                text("""
                CREATE TABLE events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  topic TEXT NOT NULL,
                  payload TEXT NOT NULL,
                  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """)
            )
    print("[DB] ✅ SQLite initialized")
