"""SQLAlchemy models for local app state (SQLite)."""
from sqlalchemy import Column, Integer, String, DateTime, Index
from sqlalchemy.sql import func
from app.database import AppBase


class Download(AppBase):
    """Audit log of every form PDF downloaded."""
    __tablename__ = "downloads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    form_id = Column(String(50), nullable=False, index=True)
    downloaded_at = Column(DateTime, server_default=func.now(), nullable=False)
    form_modified_at = Column(
        DateTime, nullable=True,
        comment="form.modified timestamp at download time, for redownload detection"
    )
    trigger_type = Column(String(10), nullable=False, default="single")
    file_size_bytes = Column(Integer, nullable=True)
    # user_id column deferred until auth is added

    __table_args__ = (
        Index("ix_downloads_form", "form_id", "downloaded_at"),
    )