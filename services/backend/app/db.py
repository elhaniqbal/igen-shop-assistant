import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/igen.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    future=True,
    pool_pre_ping=True,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
import os
print("[INFO] cwd:", os.getcwd())
print("[INFO] sqlite file:", os.path.abspath(engine.url.database))
class Base(DeclarativeBase):
    pass

def init_db():
    if DATABASE_URL.startswith("sqlite:///./"):
        os.makedirs("./data", exist_ok=True)

    from . import models  # noqa: F401
    print("[INFO] tables seen:", list(Base.metadata.tables.keys()))
    Base.metadata.create_all(bind=engine)
    print("[INFO]: DATABASE INITIALIZED")
    with engine.connect() as conn:
        rows = conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    print("[INFO] tables in sqlite_master:", [r[0] for r in rows])