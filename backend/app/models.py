"""SQLAlchemy models for local app state (SQLite)."""
from sqlalchemy import Column, Integer, String, DateTime, Index, UniqueConstraint
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


class NotificationSent(AppBase):
    """Audit log of Teams notifications sent per (form, modified_at) pair.
    The unique constraint on (form_id, form_modified_at) is the dedup key:
    a re-modified form has a new form_modified_at and becomes eligible again."""
    __tablename__ = "notifications_sent"

    id = Column(Integer, primary_key=True, autoincrement=True)
    form_id = Column(String(50), nullable=False)
    form_modified_at = Column(DateTime, nullable=False)
    sent_at = Column(DateTime, server_default=func.now(), nullable=False)
    status = Column(String(16), nullable=False, default="sent",
                    comment="'sent' | 'failed' | 'bootstrap'")
    template_name = Column(String(100), nullable=True)
    http_status = Column(Integer, nullable=True,
                         comment="HTTP status from Power Automate on send; null for bootstrap")
    error_message = Column(String(500), nullable=True)

    __table_args__ = (
        UniqueConstraint("form_id", "form_modified_at", name="uq_notifications_form_modified"),
        Index("ix_notifications_form", "form_id", "form_modified_at"),
    )