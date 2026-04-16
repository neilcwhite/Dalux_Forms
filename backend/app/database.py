"""Database connection and session setup.

Two databases:
- MariaDB (Dalux data, read-only for this app): the main `engine` / `SessionLocal`
- SQLite (local app state, read-write): `app_engine` / `AppSessionLocal`

MariaDB is remote over VPN. SQLite is a single file on disk at backend/data/app.db.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings
from pathlib import Path

# MariaDB - Dalux data (read-only pattern for this app)
engine = create_engine(
    settings.DB_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=settings.DEBUG,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# SQLite - local app state
DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
APP_DB_PATH = DATA_DIR / "app.db"
APP_DB_URL = f"sqlite:///{APP_DB_PATH}"

app_engine = create_engine(
    APP_DB_URL,
    connect_args={"check_same_thread": False},  # FastAPI shares conn across threads
    echo=settings.DEBUG,
)
AppSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=app_engine)
AppBase = declarative_base()


def get_db():
    """Dependency - yields a MariaDB session (Dalux data)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_app_db():
    """Dependency - yields a SQLite session (local app state)."""
    db = AppSessionLocal()
    try:
        yield db
    finally:
        db.close()