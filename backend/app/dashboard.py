"""Dashboard endpoints — real data for /dashboard, /dashboard/sectors,
/sites/:sos, plus an activity feed.

All four endpoints accept `?range=90d|30d|7d|1y|all` (defaults to 90d) and
restrict their "in-range" counts accordingly. Cumulative totals and the
per-form download status (pending/stale) are computed against the full
form set, since a form created two years ago that just went stale is still
relevant on the dashboard.

Mounted at /api/dashboard/* + /api/activity by main.py.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text, DateTime, String, Integer
from sqlalchemy.orm import Session

from app.database import get_db, get_app_db
from app.templates_userland import loader as template_loader


router = APIRouter(tags=["dashboard"])

# Range parameter → cutoff timedelta. "all" means no lower bound.
_RANGES: dict[str, Optional[timedelta]] = {
    "7d":   timedelta(days=7),
    "30d":  timedelta(days=30),
    "90d":  timedelta(days=90),
    "1y":   timedelta(days=365),
    "all":  None,
}

# Stale window — same definition as /api/sites/form-summary uses
STALE_DAYS = 7


# ---------------------------------------------------------------------------
# Shared loaders
# ---------------------------------------------------------------------------

def _range_cutoff(range_param: str) -> Optional[datetime]:
    delta = _RANGES.get(range_param)
    if delta is None:
        return None
    return datetime.utcnow() - delta


def _mapped_template_names() -> list[str]:
    """Templates with a custom-report builder registered (built-in + uploaded).
    Dashboard metrics restrict themselves to these — forms whose template
    has no custom report (e.g. raw ITP checklists) aren't downloadable as
    PDFs from this app, so they're noise on a "downloadable reports"
    dashboard."""
    return list(template_loader.get_templates_with_custom_report().keys())


# Sector display name normalisation. M&E is operationally subsumed into Rail,
# so it's rolled up at the dashboard layer rather than re-tagged in the DB.
# Add other consolidations here if more sectors merge in future.
_SECTOR_ALIASES: dict[str, str] = {
    "M&E": "Rail",
}


def _normalise_sector(name: Optional[str]) -> str:
    if not name:
        return "Unassigned"
    return _SECTOR_ALIASES.get(name, name)


def _fetch_forms(
    db: Session,
    since: Optional[datetime],
    only_mapped_templates: bool = True,
) -> list[dict]:
    """All forms (optionally limited by created cutoff) with project + site
    metadata. By default returns only forms whose template has a registered
    custom report — pass only_mapped_templates=False to see everything."""
    where = ["(f.deleted = 0 OR f.deleted IS NULL)"]
    binds: dict = {}
    if since is not None:
        where.append("f.created >= :since")
        binds["since"] = since

    if only_mapped_templates:
        templates = _mapped_template_names()
        if not templates:
            # No custom-report templates registered → no forms to count
            return []
        placeholders = ",".join(f":tpl{i}" for i in range(len(templates)))
        where.append(f"f.template_name IN ({placeholders})")
        for i, tn in enumerate(templates):
            binds[f"tpl{i}"] = tn

    rows = db.execute(text(f"""
        SELECT
            f.formId, f.projectId, f.template_name, f.status,
            f.created, f.modified, f.createdBy_userId,
            COALESCE(s.site_name, p.projectName) AS site_display,
            s.sos_number, s.sector, s.client,
            s.start_on_site_date, s.finish_on_site_date,
            s.primary_contact, s.dalux_id, s.status AS site_status
        FROM DLX_2_forms f
        LEFT JOIN DLX_2_projects p
          ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s
          ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        WHERE {' AND '.join(where)}
        ORDER BY f.created DESC
    """), binds).mappings().all()
    return [dict(r) for r in rows]


def _fetch_downloads(app_db: Session, form_ids: list[str]) -> dict[str, dict]:
    """Returns {form_id: {last_downloaded_at, last_dl_form_modified, count}}."""
    if not form_ids:
        return {}
    out: dict[str, dict] = {}
    BATCH = 500
    for i in range(0, len(form_ids), BATCH):
        chunk = form_ids[i:i + BATCH]
        ph = ",".join(f":f{j}" for j in range(len(chunk)))
        binds = {f"f{j}": fid for j, fid in enumerate(chunk)}
        # .columns() declares types so SQLite's string-stored datetimes
        # coerce to real datetime objects (raw text() loses type info).
        stmt = text(
            f"SELECT form_id, "
            f"  MAX(downloaded_at) AS last_downloaded_at, "
            f"  MAX(form_modified_at) AS last_dl_form_modified, "
            f"  COUNT(*) AS download_count "
            f"FROM downloads WHERE form_id IN ({ph}) GROUP BY form_id"
        ).columns(
            form_id=String, last_downloaded_at=DateTime,
            last_dl_form_modified=DateTime, download_count=Integer,
        )
        rows = app_db.execute(stmt, binds).mappings().all()
        for r in rows:
            out[r["form_id"]] = dict(r)
    return out


def _classify_form(form: dict, dl: Optional[dict]) -> str:
    """Returns 'downloaded' | 'pending' | 'stale'.
    pending = never downloaded
    stale = downloaded once, but form modified after last download
    """
    if not dl or dl.get("download_count", 0) == 0:
        return "pending"
    last_dl_mod = dl.get("last_dl_form_modified")
    if last_dl_mod and form.get("modified"):
        try:
            ts = last_dl_mod
            if isinstance(ts, str):
                ts = datetime.fromisoformat(ts)
            if form["modified"] > ts:
                return "stale"
        except Exception:
            pass
    return "downloaded"


def _all_sites(db: Session) -> list[dict]:
    rows = db.execute(text("""
        SELECT s.sos_number, s.site_name, s.sos_name, s.sector, s.client,
               s.dalux_id, s.status, s.start_on_site_date, s.finish_on_site_date,
               s.primary_contact,
               p.projectName AS dalux_project_name
        FROM sheq_sites s
        LEFT JOIN DLX_2_projects p
          ON p.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        WHERE s.dalux_id IS NOT NULL AND s.dalux_id != ''
    """)).mappings().all()
    return [dict(r) for r in rows]


def _weekly_trend(forms: list[dict], weeks: int = 12) -> list[int]:
    """Return list of N weekly counts ending in the current week."""
    counts = [0] * weeks
    now = datetime.utcnow()
    week0_start = now - timedelta(days=now.weekday(), hours=now.hour,
                                  minutes=now.minute, seconds=now.second,
                                  microseconds=now.microsecond)
    for f in forms:
        c = f.get("created")
        if not c:
            continue
        delta_weeks = (week0_start.date() - (c.date() if isinstance(c, datetime) else c)).days // 7
        if 0 <= delta_weeks < weeks:
            idx = (weeks - 1) - delta_weeks
            counts[idx] += 1
    return counts


def _avg_days_open_to_closed(forms: list[dict]) -> Optional[float]:
    """Average days between created and modified, for closed forms.
    Modified-on-close is the best proxy we have without a closed_at field."""
    deltas = []
    for f in forms:
        if f.get("status") != "closed":
            continue
        if not f.get("created") or not f.get("modified"):
            continue
        d = (f["modified"] - f["created"]).total_seconds() / 86400.0
        if d >= 0:
            deltas.append(d)
    if not deltas:
        return None
    return sum(deltas) / len(deltas)


def _avg_days_closed_to_dl(forms: list[dict], downloads: dict[str, dict]) -> Optional[float]:
    """Average days between form last-modified (proxy for closed) and first
    download. Excludes forms that haven't been downloaded."""
    deltas = []
    for f in forms:
        if f.get("status") != "closed":
            continue
        dl = downloads.get(f["formId"])
        if not dl or not dl.get("last_downloaded_at"):
            continue
        last_dl = dl["last_downloaded_at"]
        if isinstance(last_dl, str):
            last_dl = datetime.fromisoformat(last_dl)
        modified = f.get("modified")
        if not modified:
            continue
        d = (last_dl - modified).total_seconds() / 86400.0
        if d >= 0:
            deltas.append(d)
    if not deltas:
        return None
    return sum(deltas) / len(deltas)


# ---------------------------------------------------------------------------
# /api/dashboard/group
# ---------------------------------------------------------------------------

@router.get("/api/dashboard/group")
def dashboard_group(
    range: str = Query("90d", description="One of 7d, 30d, 90d, 1y, all"),
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """Group-level aggregates for the main dashboard:
    - per-sector counts (sites, active, dormant, forms, pending, stale, trend)
    - attention list (top sites by pending + stale)
    """
    if range not in _RANGES:
        raise HTTPException(400, f"unknown range {range!r}")

    cutoff = _range_cutoff(range)
    forms_in_range = _fetch_forms(db, cutoff)
    # All-time fetch only for the attention list (cumulative pending/stale)
    forms_all_time = _fetch_forms(db, None) if cutoff else forms_in_range
    download_data = _fetch_downloads(app_db, [f["formId"] for f in forms_all_time])

    sites = _all_sites(db)

    # "Active" = any form created within the selected range
    active_dalux_ids: set[str] = {
        f["dalux_id"] for f in forms_in_range if f.get("dalux_id")
    }

    # Per-sector aggregation — counts and classifications all use forms_in_range
    # so the math adds up (pending + stale + downloaded = total).
    sector_data: dict[str, dict] = defaultdict(lambda: {
        "sites": set(),
        "active": set(),
        "forms_in_range": [],
        "downloaded": 0,
        "pending": 0,
        "stale": 0,
    })

    for s in sites:
        sector = _normalise_sector(s.get("sector"))
        sector_data[sector]["sites"].add(s["dalux_id"])
        if s["dalux_id"] in active_dalux_ids:
            sector_data[sector]["active"].add(s["dalux_id"])

    for f in forms_in_range:
        sector = _normalise_sector(f.get("sector"))
        b = sector_data[sector]
        b["forms_in_range"].append(f)
        cls = _classify_form(f, download_data.get(f["formId"]))
        b[cls] = b.get(cls, 0) + 1

    sectors_out = []
    for sector_name, d in sector_data.items():
        if not d["sites"]:
            continue
        sectors_out.append({
            "name": sector_name,
            "sites": len(d["sites"]),
            "active": len(d["active"]),
            "dormant": len(d["sites"]) - len(d["active"]),
            "total": len(d["forms_in_range"]),
            "downloaded": d["downloaded"],
            "pending": d["pending"],
            "stale": d["stale"],
            "trend": _weekly_trend(d["forms_in_range"], 12),
        })
    sectors_out.sort(key=lambda x: x["total"], reverse=True)

    # Attention list — cumulative across all time. A stale form from 6 months
    # ago is still attention-worthy regardless of the range filter.
    site_aggs: dict[str, dict] = {}
    for f in forms_all_time:
        dalux = f.get("dalux_id")
        if not dalux:
            continue
        s = site_aggs.setdefault(dalux, {
            "dalux_id": dalux,
            "sos_number": f.get("sos_number"),
            "site_name": f.get("site_display") or "(unknown)",
            "sector": _normalise_sector(f.get("sector")),
            "total": 0, "downloaded": 0, "pending": 0, "stale": 0,
        })
        s["total"] += 1
        cls = _classify_form(f, download_data.get(f["formId"]))
        s[cls] += 1

    attention = sorted(
        [s for s in site_aggs.values() if (s["pending"] + s["stale"]) > 0],
        key=lambda s: (s["stale"], s["pending"]),
        reverse=True,
    )[:6]
    for s in attention:
        s["pct"] = round((s["downloaded"] / s["total"]) * 100) if s["total"] else 0

    return {
        "range": range,
        "sectors": sectors_out,
        "attention": attention,
    }


# ---------------------------------------------------------------------------
# /api/dashboard/sectors
# ---------------------------------------------------------------------------

@router.get("/api/dashboard/sectors")
def dashboard_sectors(
    range: str = Query("90d"),
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """Sector comparison page — same per-sector data as /group but adds
    velocity (open→closed, closed→download), coverage %, top template, and
    top project per sector."""
    if range not in _RANGES:
        raise HTTPException(400, f"unknown range {range!r}")

    cutoff = _range_cutoff(range)
    forms_in_range = _fetch_forms(db, cutoff)
    download_data = _fetch_downloads(app_db, [f["formId"] for f in forms_in_range])
    sites = _all_sites(db)

    active_dalux_ids = {f["dalux_id"] for f in forms_in_range if f.get("dalux_id")}

    sector_buckets: dict[str, dict] = defaultdict(lambda: {
        "sites": set(),
        "active": set(),
        "forms_in_range": [],
        "downloaded": 0,
        "pending": 0,
        "stale": 0,
        "templates": defaultdict(int),
        "by_project": defaultdict(int),
        "project_names": {},
    })

    for s in sites:
        sector = _normalise_sector(s.get("sector"))
        sector_buckets[sector]["sites"].add(s["dalux_id"])
        if s["dalux_id"] in active_dalux_ids:
            sector_buckets[sector]["active"].add(s["dalux_id"])

    for f in forms_in_range:
        sector = _normalise_sector(f.get("sector"))
        b = sector_buckets[sector]
        b["forms_in_range"].append(f)
        cls = _classify_form(f, download_data.get(f["formId"]))
        b[cls] = b.get(cls, 0) + 1
        if f.get("template_name"):
            b["templates"][f["template_name"]] += 1
        dalux = f.get("dalux_id") or f.get("projectId")
        if dalux:
            b["by_project"][dalux] += 1
            b["project_names"][dalux] = (
                (f.get("sos_number") and f"{f['sos_number']} · {f.get('site_display') or '(unknown)'}")
                or (f.get("site_display") or "(unknown)")
            )

    out = []
    for sector_name, b in sector_buckets.items():
        if not b["sites"]:
            continue
        total_in_range = len(b["forms_in_range"])
        coverage = round((b["downloaded"] / total_in_range) * 100) if total_in_range else 0

        top_proj_id, top_proj_count = (None, 0)
        if b["by_project"]:
            top_proj_id, top_proj_count = max(b["by_project"].items(), key=lambda kv: kv[1])
        top_templates = sorted(b["templates"].items(), key=lambda kv: kv[1], reverse=True)[:5]

        out.append({
            "name": sector_name,
            "sites": len(b["sites"]),
            "active": len(b["active"]),
            "dormant": len(b["sites"]) - len(b["active"]),
            "total": total_in_range,
            "downloaded": b["downloaded"],
            "pending": b["pending"],
            "stale": b["stale"],
            "trend": _weekly_trend(b["forms_in_range"], 12),
            "open_to_closed_days": _avg_days_open_to_closed(b["forms_in_range"]),
            "closed_to_dl_days": _avg_days_closed_to_dl(b["forms_in_range"], download_data),
            "coverage": coverage,
            "top_project": b["project_names"].get(top_proj_id) if top_proj_id else None,
            "top_project_forms": top_proj_count,
            "top_templates": [{"name": n, "count": c} for n, c in top_templates],
        })
    out.sort(key=lambda x: x["total"], reverse=True)
    return {"range": range, "sectors": out}


# ---------------------------------------------------------------------------
# /api/dashboard/projects/{sos_number}
# ---------------------------------------------------------------------------

@router.get("/api/dashboard/projects/{sos_number}")
def dashboard_project(
    sos_number: str,
    range: str = Query("30d"),
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """Per-site dashboard — looked up by SHEQ SOS number (e.g. 'C2204')."""
    if range not in _RANGES:
        raise HTTPException(400, f"unknown range {range!r}")

    site = db.execute(text("""
        SELECT s.id, s.sos_number, s.site_name, s.sos_name, s.sector, s.client,
               s.dalux_id, s.status, s.start_on_site_date, s.finish_on_site_date,
               s.primary_contact,
               p.projectName AS dalux_project_name
        FROM sheq_sites s
        LEFT JOIN DLX_2_projects p
          ON p.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        WHERE s.sos_number = :sos LIMIT 1
    """), {"sos": sos_number}).mappings().first()
    if not site:
        raise HTTPException(404, f"site {sos_number} not found in sheq_sites")
    site = dict(site)

    if not site.get("dalux_id"):
        # Site exists but isn't mapped to a Dalux project — return shell + empty data
        return {
            "site": _shape_site(site),
            "range": range,
            "daily": [0] * 30,
            "total": 0, "downloaded": 0, "pending": 0, "stale": 0,
            "open_to_closed_days": None, "closed_to_dl_days": None,
            "templates": [], "contributors": [], "recent": [],
        }

    # Only include forms whose template has a registered custom report —
    # raw ITP checklists etc. are noise on a "downloadable reports" dashboard.
    # NB: `range` param shadows builtin range() in this function's scope, so
    # use enumerate for placeholder generation.
    templates = _mapped_template_names()
    if not templates:
        forms = []
    else:
        placeholders = ",".join(f":tpl{i}" for i, _ in enumerate(templates))
        binds: dict = {"pid": site["dalux_id"]}
        for i, tn in enumerate(templates):
            binds[f"tpl{i}"] = tn
        forms = db.execute(text(f"""
            SELECT f.formId, f.projectId, f.template_name, f.status, f.number,
                   f.created, f.modified, f.createdBy_userId,
                   u.firstName, u.lastName
            FROM DLX_2_forms f
            LEFT JOIN DLX_2_users u
              ON f.createdBy_userId COLLATE utf8mb4_unicode_ci = u.userId COLLATE utf8mb4_unicode_ci
             AND f.projectId COLLATE utf8mb4_unicode_ci = u.projectId COLLATE utf8mb4_unicode_ci
            WHERE f.projectId = :pid
              AND (f.deleted = 0 OR f.deleted IS NULL)
              AND f.template_name IN ({placeholders})
            ORDER BY f.created DESC
        """), binds).mappings().all()
        forms = [dict(r) for r in forms]

    download_data = _fetch_downloads(app_db, [f["formId"] for f in forms])

    # 30-day daily counts (always 30 days regardless of range param)
    daily = [0] * 30
    today = datetime.utcnow().date()
    for f in forms:
        c = f.get("created")
        if not c:
            continue
        c_date = c.date() if isinstance(c, datetime) else c
        delta = (today - c_date).days
        if 0 <= delta < 30:
            daily[29 - delta] += 1

    # Totals + classification
    downloaded_count = pending_count = stale_count = 0
    for f in forms:
        cls = _classify_form(f, download_data.get(f["formId"]))
        if cls == "downloaded": downloaded_count += 1
        elif cls == "pending": pending_count += 1
        else: stale_count += 1

    # Templates + contributors (in-range)
    cutoff = _range_cutoff(range)
    in_range_forms = [f for f in forms if cutoff is None or (f.get("created") and f["created"] >= cutoff)]

    template_counts: dict[str, int] = defaultdict(int)
    for f in in_range_forms:
        if f.get("template_name"):
            template_counts[f["template_name"]] += 1
    templates = sorted(
        [{"name": n, "count": c} for n, c in template_counts.items()],
        key=lambda x: x["count"], reverse=True,
    )[:8]

    contrib_counts: dict[str, dict] = {}
    for f in in_range_forms:
        uid = f.get("createdBy_userId")
        if not uid:
            continue
        first = (f.get("firstName") or "").strip()
        last = (f.get("lastName") or "").strip()
        name = " ".join(p.capitalize() for p in f"{first} {last}".split()) or "(unknown user)"
        c = contrib_counts.setdefault(uid, {"name": name, "role": None, "forms": 0})
        c["forms"] += 1
    contributors = sorted(contrib_counts.values(), key=lambda x: x["forms"], reverse=True)[:5]

    # Recent forms — show enough that the per-site picker can do meaningful
    # bulk downloads (e.g. a monthly batch). FormsPage at /forms?site=…
    # remains the path beyond this cap.
    recent = []
    for f in forms[:50]:
        cls = _classify_form(f, download_data.get(f["formId"]))
        status_label = "Downloaded" if cls == "downloaded" else "Stale" if cls == "stale" else (
            "Closed" if f.get("status") == "closed" else "Open"
        )
        recent.append({
            "form_id": f["formId"],
            "number": f.get("number") or f["formId"],
            "template": f.get("template_name") or "(unknown)",
            "by": (
                " ".join(p.capitalize() for p in f"{(f.get('firstName') or '').strip()} {(f.get('lastName') or '').strip()}".split())
                or "(unknown user)"
            ),
            "when_iso": f["created"].isoformat() if f.get("created") else None,
            "status": status_label,
        })

    return {
        "site": _shape_site(site),
        "range": range,
        "daily": daily,
        "total": len(forms),
        "downloaded": downloaded_count,
        "pending": pending_count,
        "stale": stale_count,
        "open_to_closed_days": _avg_days_open_to_closed(in_range_forms),
        "closed_to_dl_days": _avg_days_closed_to_dl(in_range_forms, download_data),
        "templates": templates,
        "contributors": contributors,
        "recent": recent,
    }


def _shape_site(s: dict) -> dict:
    """Pluck the site fields the page needs into a flat shape."""
    name = s.get("site_name") or s.get("sos_name") or s.get("dalux_project_name") or "(unnamed)"
    return {
        "sos_number": s.get("sos_number"),
        "dalux_id": s.get("dalux_id"),
        "name": name,
        "sector": _normalise_sector(s.get("sector")),
        "client": s.get("client"),
        "status": s.get("status") or "Active",
        "primary_contact": s.get("primary_contact"),
        "start_on_site_date": s.get("start_on_site_date").isoformat() if s.get("start_on_site_date") else None,
        "finish_on_site_date": s.get("finish_on_site_date").isoformat() if s.get("finish_on_site_date") else None,
    }


# ---------------------------------------------------------------------------
# /api/activity
# ---------------------------------------------------------------------------

@router.get("/api/activity")
def recent_activity(
    since: str = Query("24h", description="One of 24h, 7d, 30d"),
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """Recent events across the system: forms created, downloads, stale-ings.
    Used by the Group Dashboard's activity feed."""
    since_map = {
        "24h": timedelta(hours=24),
        "7d":  timedelta(days=7),
        "30d": timedelta(days=30),
    }
    if since not in since_map:
        raise HTTPException(400, f"unknown since {since!r}")
    cutoff = datetime.utcnow() - since_map[since]

    # Activity feed shows only forms with registered custom reports — those
    # are the ones doc control needs to know about (downloadable).
    templates = _mapped_template_names()
    if not templates:
        new_forms = []
    else:
        ph_t = ",".join(f":tpl{i}" for i in range(len(templates)))
        binds_t = {"cutoff": cutoff, "limit": limit * 2}
        for i, tn in enumerate(templates):
            binds_t[f"tpl{i}"] = tn
        new_forms = db.execute(text(f"""
            SELECT f.formId, f.template_name, f.created, f.number, f.status,
                   COALESCE(s.site_name, p.projectName) AS site_display,
                   s.sos_number, s.sector,
                   u.firstName, u.lastName
            FROM DLX_2_forms f
            LEFT JOIN DLX_2_projects p
              ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
            LEFT JOIN sheq_sites s
              ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
            LEFT JOIN DLX_2_users u
              ON f.createdBy_userId COLLATE utf8mb4_unicode_ci = u.userId COLLATE utf8mb4_unicode_ci
             AND f.projectId COLLATE utf8mb4_unicode_ci = u.projectId COLLATE utf8mb4_unicode_ci
            WHERE f.created >= :cutoff
              AND (f.deleted = 0 OR f.deleted IS NULL)
              AND f.template_name IN ({ph_t})
            ORDER BY f.created DESC
            LIMIT :limit
        """), binds_t).mappings().all()

    downloads = app_db.execute(text("""
        SELECT form_id, downloaded_at, trigger_type, file_size_bytes
        FROM downloads
        WHERE downloaded_at >= :cutoff
        ORDER BY downloaded_at DESC
        LIMIT :limit
    """).columns(
        form_id=String, downloaded_at=DateTime,
        trigger_type=String, file_size_bytes=Integer,
    ), {"cutoff": cutoff, "limit": limit * 2}).mappings().all()

    # Look up form context for each download
    dl_form_ids = list({d["form_id"] for d in downloads})
    form_context: dict[str, dict] = {}
    if dl_form_ids:
        ph = ",".join(f":f{i}" for i in range(len(dl_form_ids)))
        binds = {f"f{i}": fid for i, fid in enumerate(dl_form_ids)}
        for r in db.execute(text(f"""
            SELECT f.formId, f.template_name, f.number,
                   COALESCE(s.site_name, p.projectName) AS site_display,
                   s.sos_number, s.sector
            FROM DLX_2_forms f
            LEFT JOIN DLX_2_projects p ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
            LEFT JOIN sheq_sites s ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
            WHERE f.formId IN ({ph})
        """), binds).mappings().all():
            form_context[r["formId"]] = dict(r)

    events = []
    for f in new_forms:
        first = (f.get("firstName") or "").strip()
        last  = (f.get("lastName") or "").strip()
        actor = " ".join(p.capitalize() for p in f"{first} {last}".split()) or "Someone"
        site  = f.get("site_display") or "(unknown site)"
        sos   = f.get("sos_number")
        events.append({
            "kind": "form_created",
            "icon": "+",
            "tone": "info",
            "at": f["created"].isoformat() if f.get("created") else None,
            "text": f"{actor} raised {f.get('template_name') or '(unknown template)'} on "
                    f"{(sos + ' · ' + site) if sos else site}",
            "form_id": f["formId"],
            "sos_number": sos,
        })

    for d in downloads:
        ctx = form_context.get(d["form_id"]) or {}
        site = ctx.get("site_display") or "(unknown site)"
        sos = ctx.get("sos_number")
        kind = "bulk_download" if d.get("trigger_type") == "bulk" else "download"
        events.append({
            "kind": kind,
            "icon": "✓",
            "tone": "ok",
            "at": d["downloaded_at"].isoformat() if d.get("downloaded_at") else None,
            "text": f"PDF downloaded — {ctx.get('template_name') or '(unknown template)'} on "
                    f"{(sos + ' · ' + site) if sos else site}",
            "form_id": d["form_id"],
            "sos_number": sos,
        })

    # Order by timestamp desc, then trim to limit
    def _ts(e):
        return e["at"] or "0000"
    events.sort(key=_ts, reverse=True)
    return {"since": since, "events": events[:limit]}
