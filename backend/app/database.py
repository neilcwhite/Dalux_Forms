"""Database connection and session setup."""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

engine = create_engine(
    settings.DB_URL,
    pool_pre_ping=True,   # checks connection health before using
    pool_recycle=3600,    # recycle connections after 1 hour
    echo=settings.DEBUG,  # logs SQL queries when DEBUG=true
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    """FastAPI dependency - yields a database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()