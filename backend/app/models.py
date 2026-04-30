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


class HiddenProject(AppBase):
    """Admin: Dalux projects manually hidden from the admin worklist.
    UI concern only — does not affect form filtering, sites listing, or
    report generation. A hidden project still renders correctly if a form
    is downloaded against it."""
    __tablename__ = "hidden_projects"

    dalux_project_id = Column(String(64), primary_key=True)
    hidden_at = Column(DateTime, server_default=func.now(), nullable=False)


class TemplateUploadAudit(AppBase):
    """Append-only log of every template-upload action (success and failure).

    Captures *what changed and when* — operationally important because the
    upload feature is, by design, remote code execution. IT can review at
    any time. Records uploads, disables, enables, and deletes."""
    __tablename__ = "template_uploads_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    uploaded_at = Column(DateTime, server_default=func.now(), nullable=False)
    form_code = Column(String(32), nullable=False, index=True)
    version = Column(Integer, nullable=True,
                     comment="Assigned version on success; null if rejected before assignment")
    valid_from = Column(String(10), nullable=True, comment="ISO date YYYY-MM-DD")
    python_sha256 = Column(String(64), nullable=True)
    template_sha256 = Column(String(64), nullable=True)
    outcome = Column(String(16), nullable=False,
                     comment="'registered' | 'rejected' | 'disabled' | 'enabled' | 'deleted'")
    error_message = Column(String(500), nullable=True)
    uploader_ip = Column(String(64), nullable=True)