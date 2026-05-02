"""Teams notifications — candidate detection, PDF render, SharePoint upload, Teams card.

The flow: query MariaDB for closed forms in custom-report templates → filter
against SQLite downloads (modified-since-last-download rule) → drop forms
already in notifications_sent → render PDF → upload to SharePoint → POST
body to Power Automate (Teams card links to the SharePoint URL, not back
to this app) → record result.

Deliberately synchronous; APScheduler handles the timing. No retry queue —
failures are recorded with status='failed' and eligible to retry on the next
scheduled run because the dedup only treats status='sent'/'bootstrap' as
already-handled. SharePoint's conflictBehavior=replace makes re-upload safe.
"""
from __future__ import annotations
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import requests
from sqlalchemy import text, DateTime, String
from sqlalchemy.orm import Session

from app.config import settings
from app.models import NotificationSent
from app.reports.service import generate_report, ReportError
from app.sharepoint.client import get_client as get_sharepoint_client, SharePointError

logger = logging.getLogger(__name__)

# Same template list as main.py TEMPLATES_WITH_CUSTOM_REPORT. Imported lazily
# to avoid circular imports (main.py imports models which could import this).
def _custom_report_templates() -> dict:
    from app.main import TEMPLATES_WITH_CUSTOM_REPORT
    return TEMPLATES_WITH_CUSTOM_REPORT


@dataclass
class Candidate:
    form_id: str
    template_name: str
    form_code: str
    template_display: str
    form_number: Optional[str]
    status: str
    modified: datetime
    site_name: str
    sos_number: Optional[str]
    created: Optional[datetime] = None
    creator_name: str = ""
    creator_email: str = ""


def find_candidates(mdb: Session, adb: Session) -> list[Candidate]:
    """Return closed custom-report forms that need a notification."""
    templates = _custom_report_templates()
    if not templates:
        return []

    template_names = list(templates.keys())
    placeholders = ",".join(f":t{i}" for i in range(len(template_names)))
    binds = {f"t{i}": tn for i, tn in enumerate(template_names)}

    rows = mdb.execute(text(f"""
        SELECT f.formId, f.template_name, f.number, f.status,
               f.created, f.modified,
               COALESCE(s.site_name, p.projectName) AS site_name,
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
        WHERE f.status = 'closed'
          AND f.template_name IN ({placeholders})
          AND (f.deleted = 0 OR f.deleted IS NULL)
    """), binds).mappings().all()

    if not rows:
        return []

    form_ids = [r["formId"] for r in rows]
    last_download = _last_download_by_form(adb, form_ids)
    already_notified = _notified_pairs(adb, form_ids)

    candidates: list[Candidate] = []
    for r in rows:
        fid = r["formId"]
        modified: datetime = r["modified"]
        if modified is None:
            continue

        last_dl = last_download.get(fid)
        # Keep if never downloaded, or modified since last download.
        if last_dl is not None and modified <= last_dl:
            continue

        # Dedup: already notified for this (form_id, modified) pair?
        if (fid, modified) in already_notified:
            continue

        tpl = templates.get(r["template_name"], {})
        first = (r.get("creator_first") or "").strip()
        last = (r.get("creator_last") or "").strip()
        creator_name = " ".join(p.capitalize() for p in f"{first} {last}".split())
        candidates.append(Candidate(
            form_id=fid,
            template_name=r["template_name"],
            form_code=tpl.get("code", ""),
            template_display=tpl.get("display", r["template_name"]),
            form_number=r["number"],
            status=r["status"],
            modified=modified,
            site_name=r["site_name"] or "",
            sos_number=r["sos_number"],
            created=r.get("created"),
            creator_name=creator_name,
            creator_email=r.get("creator_email") or "",
        ))
    return candidates


def _last_download_by_form(adb: Session, form_ids: list[str]) -> dict[str, datetime]:
    """Batch query SQLite for latest download timestamp per form_id.
    .columns() declares types so SQLite's string-stored datetimes coerce to
    real datetime objects — without it, text() queries get plain strings."""
    if not form_ids:
        return {}
    out: dict[str, datetime] = {}
    BATCH = 500
    for i in range(0, len(form_ids), BATCH):
        chunk = form_ids[i:i + BATCH]
        ph = ",".join(f":f{j}" for j in range(len(chunk)))
        binds = {f"f{j}": fid for j, fid in enumerate(chunk)}
        stmt = text(
            f"SELECT form_id, MAX(downloaded_at) AS last_dl "
            f"FROM downloads WHERE form_id IN ({ph}) GROUP BY form_id"
        ).columns(form_id=String, last_dl=DateTime)
        for r in adb.execute(stmt, binds).mappings().all():
            out[r["form_id"]] = r["last_dl"]
    return out


def _notified_pairs(adb: Session, form_ids: list[str]) -> set[tuple[str, datetime]]:
    """Batch query SQLite for (form_id, form_modified_at) pairs already notified.
    Includes 'bootstrap' and 'sent' rows; 'failed' rows do NOT block retry."""
    if not form_ids:
        return set()
    out: set[tuple[str, datetime]] = set()
    BATCH = 500
    for i in range(0, len(form_ids), BATCH):
        chunk = form_ids[i:i + BATCH]
        ph = ",".join(f":f{j}" for j in range(len(chunk)))
        binds = {f"f{j}": fid for j, fid in enumerate(chunk)}
        stmt = text(
            f"SELECT form_id, form_modified_at FROM notifications_sent "
            f"WHERE form_id IN ({ph}) AND status IN ('sent', 'bootstrap')"
        ).columns(form_id=String, form_modified_at=DateTime)
        for r in adb.execute(stmt, binds).mappings().all():
            out.add((r["form_id"], r["form_modified_at"]))
    return out


def build_payload(c: Candidate, sharepoint_url: str) -> dict:
    """Shape the POST body Power Automate will consume to render the
    Adaptive Card. Keep keys flat and simple so the flow is easy to parse.

    `download_url` is the SharePoint webUrl of the rendered PDF — the card's
    button links straight there, so doc control don't need to reach this
    app. Key kept as `download_url` so the existing flow doesn't need
    re-mapping."""
    return {
        "form_code": c.form_code,
        "form_id": c.form_id,
        "template_name": c.template_name,
        "template_display_name": c.template_display,
        "site_name": c.site_name,
        "sos_number": c.sos_number or "",
        "form_number": c.form_number or "",
        "created_at": c.created.isoformat() if c.created else "",
        "created_label": c.created.strftime("%d %b %Y") if c.created else "",
        "modified_at": c.modified.isoformat() if c.modified else "",
        "closed_label": c.modified.strftime("%d %b %Y %H:%M") if c.modified else "",
        "creator_name": c.creator_name or "",
        "creator_email": c.creator_email or "",
        "download_url": sharepoint_url,
        "folder_url": settings.SHAREPOINT_FOLDER_VIEW_URL or "",
    }


def send_notification(payload: dict) -> tuple[int, Optional[str]]:
    """POST the payload to Power Automate. Returns (http_status, error_message).
    error_message is None on success, otherwise a short description."""
    url = settings.NOTIFY_POWER_AUTOMATE_URL
    if not url:
        return 0, "NOTIFY_POWER_AUTOMATE_URL not configured"
    try:
        resp = requests.post(url, json=payload, timeout=30)
    except requests.RequestException as e:
        return 0, f"request failed: {e}"[:500]
    if resp.status_code >= 400:
        return resp.status_code, (resp.text or "")[:500]
    return resp.status_code, None


def record_notification(
    adb: Session,
    candidate: Candidate,
    status: str,
    http_status: Optional[int],
    error_message: Optional[str],
    sharepoint_url: Optional[str] = None,
) -> None:
    """Insert a notifications_sent row. Tolerates UNIQUE conflict (means
    another run already recorded this pair)."""
    row = NotificationSent(
        form_id=candidate.form_id,
        form_modified_at=candidate.modified,
        status=status,
        template_name=candidate.template_name,
        http_status=http_status,
        error_message=error_message,
        sharepoint_url=sharepoint_url,
    )
    try:
        adb.add(row)
        adb.commit()
    except Exception as e:
        adb.rollback()
        logger.warning("notifications_sent insert failed for %s: %s", candidate.form_id, e)


def _render_and_upload(c: Candidate, mdb: Session) -> tuple[Optional[str], Optional[str]]:
    """Render the closed form's PDF and push it to SharePoint.

    Returns (sharepoint_web_url, error_message). On success error_message is
    None. On failure web_url is None and error_message describes the step
    that broke (render vs upload) — that string lands in
    notifications_sent.error_message so an operator can diagnose without
    grepping logs.
    """
    try:
        pdf_bytes, filename, _ = generate_report(mdb, c.form_id)
    except ReportError as e:
        return None, f"pdf-render: {e}"[:500]
    except Exception as e:
        logger.exception("unexpected pdf render error for %s", c.form_id)
        return None, f"pdf-render-unexpected: {e}"[:500]

    try:
        sp = get_sharepoint_client()
        result = sp.upload(filename, pdf_bytes, content_type="application/pdf")
    except SharePointError as e:
        return None, f"sharepoint: {e}"[:500]
    except Exception as e:
        logger.exception("unexpected sharepoint upload error for %s", c.form_id)
        return None, f"sharepoint-unexpected: {e}"[:500]

    return result.web_url, None


def run_once(mdb: Session, adb: Session) -> dict:
    """One pass: find candidates, render PDF, upload to SharePoint, send
    Teams card, record. Returns counts for logging."""
    if not settings.NOTIFY_ENABLED:
        logger.info("notifications disabled (NOTIFY_ENABLED=false), skipping run")
        return {
            "enabled": False, "checked": 0, "sent": 0, "failed": 0,
            "skipped_no_url": 0, "render_failed": 0, "upload_failed": 0,
        }

    candidates = find_candidates(mdb, adb)
    sent = 0
    failed = 0
    skipped_no_url = 0
    render_failed = 0
    upload_failed = 0

    for c in candidates:
        sp_url, render_or_upload_error = _render_and_upload(c, mdb)
        if render_or_upload_error is not None:
            # Record as failed; next scheduler run will retry (failed rows
            # don't block dedup). Don't send a Teams card with no link.
            record_notification(
                adb, c,
                status="failed",
                http_status=None,
                error_message=render_or_upload_error,
                sharepoint_url=None,
            )
            if render_or_upload_error.startswith("pdf-render"):
                render_failed += 1
            else:
                upload_failed += 1
            logger.warning(
                "notification failed pre-send: %s %s — %s",
                c.form_code, c.form_id, render_or_upload_error,
            )
            continue

        payload = build_payload(c, sharepoint_url=sp_url)
        http_status, error = send_notification(payload)
        if error is None:
            record_notification(
                adb, c,
                status="sent",
                http_status=http_status,
                error_message=None,
                sharepoint_url=sp_url,
            )
            sent += 1
            logger.info(
                "notification sent: %s %s (http %s) → %s",
                c.form_code, c.form_id, http_status, sp_url,
            )
        elif "not configured" in (error or ""):
            # File is in SharePoint, just no Power Automate URL set.
            # Skip recording so a real send retries cleanly once configured.
            skipped_no_url += 1
            logger.warning(
                "skipping Teams send for %s %s (%s); pdf already at %s",
                c.form_code, c.form_id, error, sp_url,
            )
        else:
            record_notification(
                adb, c,
                status="failed",
                http_status=http_status or None,
                error_message=error,
                sharepoint_url=sp_url,
            )
            failed += 1
            logger.warning(
                "notification failed (post-upload): %s %s — %s",
                c.form_code, c.form_id, error,
            )

    return {
        "enabled": True,
        "checked": len(candidates),
        "sent": sent,
        "failed": failed,
        "skipped_no_url": skipped_no_url,
        "render_failed": render_failed,
        "upload_failed": upload_failed,
    }


def bootstrap_template_for_existing_forms(
    template_name: str,
    mdb: Session,
    adb: Session,
) -> int:
    """Mark every existing closed form for the given template_name as
    `bootstrap` in notifications_sent. Used when a new template is added
    to the registry — without this, all of that template's already-closed
    historical forms would fire as candidates on the next scheduler run.

    Idempotent: the UNIQUE(form_id, form_modified_at) constraint silently
    rejects rows that are already recorded, so re-running this is harmless.

    Returns the number of rows actually inserted.
    """
    rows = mdb.execute(text("""
        SELECT formId, modified
        FROM DLX_2_forms
        WHERE template_name = :tn
          AND status = 'closed'
          AND (deleted = 0 OR deleted IS NULL)
          AND modified IS NOT NULL
    """), {"tn": template_name}).all()

    inserted = 0
    for form_id, modified in rows:
        if not modified:
            continue
        try:
            adb.add(NotificationSent(
                form_id=form_id,
                form_modified_at=modified,
                status="bootstrap",
                template_name=template_name,
                http_status=None,
                error_message=None,
            ))
            adb.commit()
            inserted += 1
        except Exception:
            # UNIQUE constraint violation = already bootstrapped for this
            # (form_id, modified) pair. Silently skip; that's the point of
            # idempotence.
            adb.rollback()
    return inserted
