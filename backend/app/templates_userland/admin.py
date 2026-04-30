"""Admin endpoints for the template-upload feature.

Mounted at /api/admin/templates/* by main.py. Mutations (upload, disable,
enable, delete) are gated by the X-Admin-Token header against
settings.ADMIN_UPLOAD_TOKEN. Listing is public.

Every mutation writes a row to the template_uploads_audit table, regardless
of outcome — IT can audit the feature at any time.
"""
from __future__ import annotations
import hashlib
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_app_db
from app.models import TemplateUploadAudit
from app.templates_userland import loader as template_loader

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/templates", tags=["admin-templates"])


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

def _require_admin_token(x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")) -> None:
    """Gate for mutating endpoints. Returns 503 if feature is disabled
    (ADMIN_UPLOAD_TOKEN unset), 401 if token missing/wrong."""
    if not settings.ADMIN_UPLOAD_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="Template upload disabled — ADMIN_UPLOAD_TOKEN not set on server",
        )
    if not x_admin_token or x_admin_token != settings.ADMIN_UPLOAD_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Admin-Token")


# ---------------------------------------------------------------------------
# Listing (public — no auth)
# ---------------------------------------------------------------------------

@router.get("")
def list_templates() -> list[dict]:
    """Returns every form_code with all its versions (built-in + uploaded),
    sorted by form_code then version. Used by the Admin UI Templates tab."""
    return template_loader.serialize_versions()


@router.get("/audit")
def list_audit(
    limit: int = 100,
    app_db: Session = Depends(get_app_db),
) -> list[dict]:
    """Recent rows from template_uploads_audit, newest first."""
    rows = (
        app_db.query(TemplateUploadAudit)
        .order_by(TemplateUploadAudit.uploaded_at.desc())
        .limit(min(limit, 500))
        .all()
    )
    return [
        {
            "id": r.id,
            "uploaded_at": r.uploaded_at.isoformat() if r.uploaded_at else None,
            "form_code": r.form_code,
            "version": r.version,
            "valid_from": r.valid_from,
            "outcome": r.outcome,
            "error_message": r.error_message,
            "uploader_ip": r.uploader_ip,
            "python_sha256": r.python_sha256,
            "template_sha256": r.template_sha256,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class _UploadOk(BaseModel):
    form_code: str
    version: int
    valid_from: str
    source: str
    form_display: str
    outcome: str = "registered"


@router.post("/upload", response_model=_UploadOk, dependencies=[Depends(_require_admin_token)])
async def upload_template(
    request: Request,
    python_file: UploadFile = File(...),
    template_file: UploadFile = File(...),
    app_db: Session = Depends(get_app_db),
):
    """Validate, persist, and register a new template version. The .py is
    imported in a temp location first; if validation fails nothing is
    written to the userland volume."""
    py_bytes = await python_file.read()
    j2_bytes = await template_file.read()
    py_sha = hashlib.sha256(py_bytes).hexdigest()
    j2_sha = hashlib.sha256(j2_bytes).hexdigest()

    uploader_ip = _client_ip(request)

    try:
        v = template_loader.upload(py_bytes, j2_bytes)
    except template_loader.UploadError as e:
        # Try to extract form_code from the .py for the audit row, but it
        # might not even be a valid Python file.
        form_code_guess = _try_extract_form_code(py_bytes)
        app_db.add(TemplateUploadAudit(
            form_code=form_code_guess or "<unknown>",
            version=None,
            valid_from=None,
            python_sha256=py_sha,
            template_sha256=j2_sha,
            outcome="rejected",
            error_message=str(e)[:500],
            uploader_ip=uploader_ip,
        ))
        app_db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Defensive — any other failure is logged + audited as rejected
        logger.exception("unexpected upload error: %s", e)
        app_db.add(TemplateUploadAudit(
            form_code="<unknown>",
            version=None,
            valid_from=None,
            python_sha256=py_sha,
            template_sha256=j2_sha,
            outcome="rejected",
            error_message=f"unexpected: {e}"[:500],
            uploader_ip=uploader_ip,
        ))
        app_db.commit()
        raise HTTPException(status_code=500, detail=f"internal upload error: {e}")

    app_db.add(TemplateUploadAudit(
        form_code=v.form_code,
        version=v.version,
        valid_from=v.valid_from.isoformat(),
        python_sha256=v.python_sha256,
        template_sha256=v.template_sha256,
        outcome="registered",
        error_message=None,
        uploader_ip=uploader_ip,
    ))
    app_db.commit()

    return _UploadOk(
        form_code=v.form_code,
        version=v.version,
        valid_from=v.valid_from.isoformat(),
        source=v.source,
        form_display=v.form_display,
    )


def _try_extract_form_code(py_bytes: bytes) -> Optional[str]:
    """Best-effort string scrape so audit log can show form_code even when
    the upload was rejected too early to import the module."""
    try:
        text = py_bytes.decode("utf-8", errors="replace")
    except Exception:
        return None
    import re
    m = re.search(r"FORM_CODE\s*=\s*['\"]([A-Za-z0-9_]+)['\"]", text)
    return m.group(1) if m else None


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


# ---------------------------------------------------------------------------
# Disable / enable / delete
# ---------------------------------------------------------------------------

class _StatusResponse(BaseModel):
    form_code: str
    version: int
    outcome: str


@router.post(
    "/{form_code}/v{version}/disable",
    response_model=_StatusResponse,
    dependencies=[Depends(_require_admin_token)],
)
def disable_version(
    form_code: str,
    version: int,
    request: Request,
    app_db: Session = Depends(get_app_db),
):
    try:
        template_loader.disable(form_code, version)
    except template_loader.UploadError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _audit(app_db, form_code, version, "disabled", request)
    return _StatusResponse(form_code=form_code, version=version, outcome="disabled")


@router.post(
    "/{form_code}/v{version}/enable",
    response_model=_StatusResponse,
    dependencies=[Depends(_require_admin_token)],
)
def enable_version(
    form_code: str,
    version: int,
    request: Request,
    app_db: Session = Depends(get_app_db),
):
    try:
        template_loader.enable(form_code, version)
    except template_loader.UploadError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _audit(app_db, form_code, version, "enabled", request)
    return _StatusResponse(form_code=form_code, version=version, outcome="enabled")


@router.delete(
    "/{form_code}/v{version}",
    response_model=_StatusResponse,
    dependencies=[Depends(_require_admin_token)],
)
def delete_version(
    form_code: str,
    version: int,
    request: Request,
    app_db: Session = Depends(get_app_db),
):
    try:
        template_loader.delete(form_code, version)
    except template_loader.UploadError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _audit(app_db, form_code, version, "deleted", request)
    return _StatusResponse(form_code=form_code, version=version, outcome="deleted")


def _audit(app_db: Session, form_code: str, version: int, outcome: str, request: Request) -> None:
    app_db.add(TemplateUploadAudit(
        form_code=form_code,
        version=version,
        valid_from=None,
        python_sha256=None,
        template_sha256=None,
        outcome=outcome,
        error_message=None,
        uploader_ip=_client_ip(request),
    ))
    app_db.commit()
