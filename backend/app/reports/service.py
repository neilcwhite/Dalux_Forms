"""Orchestrates report generation.

Flow per download request:
  1. Look up form by ID in MariaDB
  2. Dispatch to template-specific builder (cs053.py etc.)
  3. Builder returns HTML string
  4. Render HTML to PDF via WeasyPrint
  5. Cache PDF on disk keyed by (form_id, form.modified)
  6. Return PDF bytes + filename

Photos are downloaded on demand from Dalux to photo_cache/ on disk.
"""
from __future__ import annotations
from datetime import datetime
from pathlib import Path
from typing import Optional
import hashlib
import requests
from sqlalchemy.orm import Session
from sqlalchemy import text
from weasyprint import HTML
from app.config import settings
from app.reports import cs053, cs037

# --- Paths ---
BACKEND_ROOT = Path(__file__).parent.parent.parent
PHOTO_CACHE = BACKEND_ROOT / "photo_cache"
REPORTS_CACHE = BACKEND_ROOT / "reports_cache"
PHOTO_CACHE.mkdir(exist_ok=True)
REPORTS_CACHE.mkdir(exist_ok=True)

# --- Template registry ---
# Key = exact Dalux template_name string from DLX_2_forms.template_name.
TEMPLATE_HANDLERS = {
    "Weekly Safety inspection": cs053,
    "Permit to Undertake Hot Work": cs037,
}


class ReportError(Exception):
    """Raised when a report cannot be generated."""


def generate_report(db: Session, form_id: str) -> tuple[bytes, str, int]:
    """
    Generate (or serve from cache) a PDF report for a form.
    Returns (pdf_bytes, filename, size_bytes).
    """
    # 1. Find the form - get template_name + modified + site info
    form_meta = db.execute(text("""
        SELECT f.formId, f.projectId, f.number, f.template_name, f.status,
               f.created, f.modified,
               COALESCE(s.site_name, p.projectName) AS site_display,
               s.sos_number,
               u.firstName AS creator_first,
               u.lastName  AS creator_last,
               u.email     AS creator_email
        FROM DLX_2_forms f
        LEFT JOIN DLX_2_projects p
          ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s
          ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        LEFT JOIN DLX_2_users u
          ON f.createdBy_userId COLLATE utf8mb4_unicode_ci = u.userId COLLATE utf8mb4_unicode_ci
         AND f.projectId COLLATE utf8mb4_unicode_ci = u.projectId COLLATE utf8mb4_unicode_ci
        WHERE f.formId = :fid
    """), {"fid": form_id}).mappings().first()

    if not form_meta:
        raise ReportError(f"Form {form_id} not found")

    handler = TEMPLATE_HANDLERS.get(form_meta["template_name"])
    if handler is None:
        raise ReportError(
            f"No report template configured for form type '{form_meta['template_name']}'"
        )

    # 2. Cache check
    cache_key = _cache_key(form_id, form_meta["modified"])
    cache_path = REPORTS_CACHE / f"{cache_key}.pdf"
    if hasattr(handler, "build_filename"):
        filename = handler.build_filename(db, form_meta)
    else:
        filename = _build_filename(form_meta)

    if cache_path.exists():
        pdf_bytes = cache_path.read_bytes()
        return pdf_bytes, filename, len(pdf_bytes)

    # 3. Build data payload via handler
    payload = handler.build_payload(db, form_id)

    # 4. Render HTML
    html_str = handler.render_html(payload)

    # 5. Render PDF
    pdf_bytes = HTML(string=html_str, base_url=str(Path(__file__).parent)).write_pdf()

    # 6. Cache it
    cache_path.write_bytes(pdf_bytes)

    return pdf_bytes, filename, len(pdf_bytes)


def fetch_photo_to_cache(
    project_id: str,
    attachment_id: str,
    download_url: Optional[str],
) -> Optional[Path]:
    """
    Ensure a photo is available on local disk. Returns path or None if fetch fails.
    Cached by (project_id, attachment_id) so we only ever download each once.
    """
    if not download_url:
        return None

    # Keep file extension from URL if present, default .jpg
    ext = ".jpg"
    for candidate in (".jpg", ".jpeg", ".png"):
        if candidate in download_url.lower():
            ext = candidate
            break

    project_dir = PHOTO_CACHE / project_id
    project_dir.mkdir(exist_ok=True)
    local_path = project_dir / f"{attachment_id}{ext}"

    if local_path.exists() and local_path.stat().st_size > 0:
        return local_path

    try:
        headers = {"X-API-KEY": settings.DALUX_API_KEY}
        r = requests.get(download_url, headers=headers, timeout=30)
        r.raise_for_status()
        local_path.write_bytes(r.content)
        return local_path
    except Exception as e:
        print(f"[photo fetch] Failed {attachment_id}: {e}")
        return None


def _cache_key(form_id: str, modified: datetime) -> str:
    """Stable cache key - regenerates whenever form is modified."""
    mod_str = modified.isoformat() if modified else "unknown"
    raw = f"{form_id}|{mod_str}"
    h = hashlib.sha1(raw.encode()).hexdigest()[:12]
    return f"{form_id}_{h}"


def _build_filename(form_meta) -> str:
    """yyyy-mm-dd_FormType_SiteName_CreatorName.pdf"""
    created: datetime = form_meta["created"]
    date_str = created.strftime("%Y-%m-%d") if created else "unknown-date"
    form_type = (form_meta.get("number") or form_meta["template_name"]).split("_")[0]
    site = (form_meta.get("site_display") or "unknown-site")
    fn = (form_meta.get("creator_first") or "").strip()
    ln = (form_meta.get("creator_last") or "").strip()
    creator = " ".join(p.capitalize() for p in f"{fn} {ln}".split()) or "unknown-user"
    safe = lambda s: "".join(c for c in s if c.isalnum() or c in " -_").strip().replace(" ", "_")
    return f"{date_str}_{safe(form_type)}_{safe(site)}_{safe(creator)}.pdf"