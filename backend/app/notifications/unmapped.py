"""Personal-pings for closed forms whose template_name is NOT in the
custom-report registry — i.e. Dalux form types Neil hasn't built a
builder for yet.

Different audience and different cadence to the doc-control flow:
  - posts to Neil's personal chat via a separate Power Automate URL
  - dedup is (template_name, latest_close_date), so a stale 21-form
    backlog stays silent until a 22nd close on a new day arrives
  - first-run uses 'bootstrap' rows to ratchet the floor without
    flooding (table-empty detection)

The same APScheduler tick that runs the main notifications also runs
this; see service.run_once for the wiring.
"""
from __future__ import annotations
import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import requests
from sqlalchemy import text, Date, DateTime, Integer, String
from sqlalchemy.orm import Session

from app.config import settings
from app.models import UnmappedTemplateAlert

logger = logging.getLogger(__name__)


def _registered_template_names() -> list[str]:
    """Lazy import to avoid circular dep with app.main."""
    from app.main import TEMPLATES_WITH_CUSTOM_REPORT
    return list(TEMPLATES_WITH_CUSTOM_REPORT.keys())


@dataclass
class UnmappedPing:
    template_name: str
    closed_count: int
    last_close_date: date            # MAX(modified::date) for this template
    most_recent_form_id: str
    most_recent_form_number: str
    most_recent_close_at: datetime
    most_recent_site: str
    most_recent_creator: str
    most_recent_creator_email: str


def find_unmapped_pings(mdb: Session, adb: Session) -> list[UnmappedPing]:
    """One row per unmapped template, but only those whose latest_close_date
    is newer than any prior ping for that template. Result respects the
    table-empty bootstrap rule indirectly: caller decides what to do with
    the list (fire vs bootstrap)."""
    registered = _registered_template_names()

    # Build the NOT IN clause; guard against an empty registry.
    if registered:
        placeholders = ",".join(f":t{i}" for i in range(len(registered)))
        not_in_clause = f"AND f.template_name NOT IN ({placeholders})"
        binds = {f"t{i}": tn for i, tn in enumerate(registered)}
    else:
        not_in_clause = ""
        binds = {}

    rows = mdb.execute(text(f"""
        WITH ranked AS (
            SELECT f.formId, f.template_name, f.number, f.modified, f.projectId,
                   f.createdBy_userId,
                   COUNT(*) OVER (PARTITION BY f.template_name) AS template_count,
                   MAX(DATE(f.modified)) OVER (PARTITION BY f.template_name) AS max_close_date,
                   ROW_NUMBER() OVER (PARTITION BY f.template_name ORDER BY f.modified DESC) AS rn
            FROM DLX_2_forms f
            WHERE f.status = 'closed'
              AND (f.deleted = 0 OR f.deleted IS NULL)
              {not_in_clause}
        )
        SELECT r.template_name, r.formId, r.number, r.modified,
               r.template_count, r.max_close_date,
               COALESCE(s.site_name, p.projectName) AS site_name,
               u.firstName AS creator_first,
               u.lastName  AS creator_last,
               u.email     AS creator_email
        FROM ranked r
        LEFT JOIN DLX_2_projects p
          ON r.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s
          ON r.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        LEFT JOIN DLX_2_users u
          ON r.createdBy_userId COLLATE utf8mb4_unicode_ci = u.userId COLLATE utf8mb4_unicode_ci
         AND r.projectId COLLATE utf8mb4_unicode_ci = u.projectId COLLATE utf8mb4_unicode_ci
        WHERE r.rn = 1
    """), binds).mappings().all()

    if not rows:
        return []

    # Pull the latest last_close_date already alerted for each template.
    alerted = _last_alerted_dates(adb, [r["template_name"] for r in rows])

    out: list[UnmappedPing] = []
    for r in rows:
        tn = r["template_name"]
        max_date: date = r["max_close_date"]
        if not isinstance(max_date, date):
            # MySQL/MariaDB sometimes returns the DATE() expr as a string under
            # certain drivers — coerce defensively.
            max_date = datetime.fromisoformat(str(max_date)).date()
        prior = alerted.get(tn)
        if prior is not None and max_date <= prior:
            continue

        first = (r.get("creator_first") or "").strip()
        last = (r.get("creator_last") or "").strip()
        creator_name = " ".join(p.capitalize() for p in f"{first} {last}".split())

        out.append(UnmappedPing(
            template_name=tn,
            closed_count=int(r["template_count"]),
            last_close_date=max_date,
            most_recent_form_id=r["formId"],
            most_recent_form_number=r.get("number") or "",
            most_recent_close_at=r["modified"],
            most_recent_site=r.get("site_name") or "",
            most_recent_creator=creator_name,
            most_recent_creator_email=r.get("creator_email") or "",
        ))
    return out


def _last_alerted_dates(adb: Session, template_names: list[str]) -> dict[str, date]:
    """Latest last_close_date per template_name from prior alerts (any
    status — sent/failed/bootstrap all advance the floor)."""
    if not template_names:
        return {}
    out: dict[str, date] = {}
    BATCH = 500
    for i in range(0, len(template_names), BATCH):
        chunk = template_names[i:i + BATCH]
        ph = ",".join(f":n{j}" for j in range(len(chunk)))
        binds = {f"n{j}": n for j, n in enumerate(chunk)}
        stmt = text(
            f"SELECT template_name, MAX(last_close_date) AS d "
            f"FROM unmapped_template_alerts WHERE template_name IN ({ph}) "
            f"GROUP BY template_name"
        ).columns(template_name=String, d=Date)
        for row in adb.execute(stmt, binds).mappings().all():
            d = row["d"]
            if d is None:
                continue
            if not isinstance(d, date):
                d = datetime.fromisoformat(str(d)).date()
            out[row["template_name"]] = d
    return out


def _table_is_empty(adb: Session) -> bool:
    return adb.execute(text(
        "SELECT 1 FROM unmapped_template_alerts LIMIT 1"
    )).first() is None


def build_payload(p: UnmappedPing) -> dict:
    return {
        "template_name": p.template_name,
        "closed_count": p.closed_count,
        "last_close_date": p.last_close_date.isoformat(),
        "last_close_label": p.last_close_date.strftime("%d %b %Y"),
        "most_recent_form_id": p.most_recent_form_id,
        "most_recent_form_number": p.most_recent_form_number,
        "most_recent_close_at": (
            p.most_recent_close_at.isoformat() if p.most_recent_close_at else ""
        ),
        "most_recent_close_label": (
            p.most_recent_close_at.strftime("%d %b %Y %H:%M")
            if p.most_recent_close_at else ""
        ),
        "most_recent_site": p.most_recent_site,
        "most_recent_creator": p.most_recent_creator,
        "most_recent_creator_email": p.most_recent_creator_email,
    }


def send_notification(payload: dict) -> tuple[int, Optional[str]]:
    url = settings.NOTIFY_UNMAPPED_POWER_AUTOMATE_URL
    if not url:
        return 0, "NOTIFY_UNMAPPED_POWER_AUTOMATE_URL not configured"
    try:
        resp = requests.post(url, json=payload, timeout=30)
    except requests.RequestException as e:
        return 0, f"request failed: {e}"[:500]
    if resp.status_code >= 400:
        return resp.status_code, (resp.text or "")[:500]
    return resp.status_code, None


def record_alert(
    adb: Session,
    p: UnmappedPing,
    status: str,
    http_status: Optional[int],
    error_message: Optional[str],
) -> None:
    row = UnmappedTemplateAlert(
        template_name=p.template_name,
        last_close_date=p.last_close_date,
        closed_count_at_ping=p.closed_count,
        most_recent_form_id=p.most_recent_form_id,
        most_recent_form_number=p.most_recent_form_number,
        most_recent_close_at=p.most_recent_close_at,
        most_recent_site=p.most_recent_site,
        most_recent_creator=p.most_recent_creator,
        status=status,
        http_status=http_status,
        error_message=error_message,
    )
    try:
        adb.add(row)
        adb.commit()
    except Exception as e:
        adb.rollback()
        logger.warning(
            "unmapped_template_alerts insert failed for %s: %s",
            p.template_name, e,
        )


def run_unmapped_once(mdb: Session, adb: Session) -> dict:
    """Detect, dedup, send, record. Returns counts for logging."""
    if not settings.NOTIFY_ENABLED:
        return {"enabled": False, "checked": 0, "sent": 0, "failed": 0,
                "bootstrap": 0, "skipped_no_url": 0}

    bootstrap_mode = _table_is_empty(adb)
    pings = find_unmapped_pings(mdb, adb)
    if not pings:
        return {"enabled": True, "checked": 0, "sent": 0, "failed": 0,
                "bootstrap": 0, "skipped_no_url": 0,
                "bootstrap_mode": bootstrap_mode}

    sent = failed = bootstrap = skipped_no_url = 0

    for p in pings:
        if bootstrap_mode:
            record_alert(adb, p, status="bootstrap", http_status=None, error_message=None)
            bootstrap += 1
            continue

        payload = build_payload(p)
        http_status, error = send_notification(payload)
        if error is None:
            record_alert(adb, p, status="sent", http_status=http_status, error_message=None)
            sent += 1
            logger.info(
                "unmapped-template ping sent: %s (count=%d, last_close=%s)",
                p.template_name, p.closed_count, p.last_close_date,
            )
        elif "not configured" in (error or ""):
            skipped_no_url += 1
            logger.warning(
                "skipping unmapped ping for %s: %s", p.template_name, error,
            )
        else:
            record_alert(adb, p, status="failed", http_status=http_status or None,
                         error_message=error)
            failed += 1
            logger.warning(
                "unmapped-template ping failed: %s — %s", p.template_name, error,
            )

    return {
        "enabled": True,
        "checked": len(pings),
        "sent": sent,
        "failed": failed,
        "bootstrap": bootstrap,
        "skipped_no_url": skipped_no_url,
        "bootstrap_mode": bootstrap_mode,
    }
