"""FastAPI application entry point."""
import io
import zipfile
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, get_app_db, app_engine, AppBase
from app import models  # noqa: F401
from app.models import Download, HiddenProject
from app.reports.service import generate_report, ReportError
from app.notifications import scheduler as notifications_scheduler
from app.templates_userland import loader as template_loader
from app.templates_userland.admin import router as templates_admin_router
from app.dashboard import router as dashboard_router

app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.DEBUG,
)
app.include_router(templates_admin_router)
app.include_router(dashboard_router)


@app.on_event("startup")
def startup_init_app_db():
    AppBase.metadata.create_all(bind=app_engine)


@app.on_event("startup")
def startup_template_registry():
    """Register built-in templates and scan templates_userland/ for any
    previously-uploaded versions. Must run before notifications start."""
    template_loader.initialize()


@app.on_event("startup")
def startup_notifications_scheduler():
    notifications_scheduler.start()


@app.on_event("shutdown")
def shutdown_notifications_scheduler():
    notifications_scheduler.shutdown()


# Replaced by the version-aware registry in app.templates_userland.loader.
# Kept as a property-like callable so existing call sites can keep doing
# `TEMPLATES_WITH_CUSTOM_REPORT.get(...)` and `name in TEMPLATES_WITH_CUSTOM_REPORT`
# — the snapshot reflects the live registry at call time, including any
# uploaded templates.
class _TemplatesWithCustomReportProxy:
    def _live(self) -> dict:
        return template_loader.get_templates_with_custom_report()

    def __contains__(self, key) -> bool:
        return key in self._live()

    def __getitem__(self, key):
        return self._live()[key]

    def get(self, key, default=None):
        return self._live().get(key, default)

    def keys(self):
        return self._live().keys()

    def items(self):
        return self._live().items()

    def __iter__(self):
        return iter(self._live())

    def __len__(self) -> int:
        return len(self._live())


TEMPLATES_WITH_CUSTOM_REPORT = _TemplatesWithCustomReportProxy()


@app.get("/")
def root():
    return {
        "app": settings.APP_NAME,
        "status": "running",
        "debug": settings.DEBUG,
    }


@app.get("/api/health/db")
def db_health(db: Session = Depends(get_db)):
    result = {}
    for table in ["sheq_sites", "DLX_2_projects", "DLX_2_forms"]:
        count = db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
        result[table] = count
    return result


@app.get("/api/sites/form-summary")
def site_form_summary(
    form_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """For each project: which custom-report templates are in use, total form count, and how many have never been downloaded.

    When `form_type` is provided, counts are restricted to that template only
    (e.g. CS053 filter → per-site counts reflect just CS053 forms). Otherwise
    all custom-report templates are aggregated.
    """
    if not TEMPLATES_WITH_CUSTOM_REPORT:
        return {}
    if form_type and form_type in TEMPLATES_WITH_CUSTOM_REPORT:
        template_list = [form_type]
    else:
        template_list = sorted(TEMPLATES_WITH_CUSTOM_REPORT)
    placeholders = ",".join(f":t{i}" for i in range(len(template_list)))
    binds = {f"t{i}": tn for i, tn in enumerate(template_list)}
    forms = db.execute(text(f"""
        SELECT f.projectId, f.template_name, f.formId, f.number, f.modified
        FROM DLX_2_forms f
        WHERE (f.deleted = 0 OR f.deleted IS NULL)
          AND f.template_name IN ({placeholders})
    """), binds).mappings().all()

    all_form_ids = [r["formId"] for r in forms]
    downloaded: set[str] = set()
    BATCH = 500
    for i in range(0, len(all_form_ids), BATCH):
        chunk = all_form_ids[i:i + BATCH]
        ph = ",".join(f":f{j}" for j in range(len(chunk)))
        bind = {f"f{j}": fid for j, fid in enumerate(chunk)}
        for dr in app_db.execute(
            text(f"SELECT DISTINCT form_id FROM downloads WHERE form_id IN ({ph})"),
            bind,
        ).mappings().all():
            downloaded.add(dr["form_id"])

    stale_cutoff = datetime.now() - timedelta(days=7)

    summary: dict[str, dict] = {}
    for r in forms:
        pid = r["projectId"]
        entry = summary.setdefault(pid, {
            "templates": {},
            "total_forms": 0,
            "undownloaded_forms": 0,
            "stale_undownloaded": 0,
        })
        entry["total_forms"] += 1
        if r["formId"] not in downloaded:
            entry["undownloaded_forms"] += 1
            if r["modified"] and r["modified"] < stale_cutoff:
                entry["stale_undownloaded"] += 1
        tpl = entry["templates"].setdefault(r["template_name"], {
            "template_name": r["template_name"],
            "short_code": (r["number"] or r["template_name"]).split("_")[0],
            "count": 0,
        })
        tpl["count"] += 1

    return {
        pid: {
            "templates": list(e["templates"].values()),
            "total_forms": e["total_forms"],
            "undownloaded_forms": e["undownloaded_forms"],
            "stale_undownloaded": e["stale_undownloaded"],
        }
        for pid, e in summary.items()
    }


@app.get("/api/sites")
def list_sites(db: Session = Depends(get_db)):
    query = text("""
        SELECT
            p.projectId AS dalux_id,
            p.projectName AS dalux_name,
            p.number AS dalux_number,
            s.sos_number,
            s.site_name,
            s.client,
            s.sector,
            s.status AS sheq_status,
            s.dalux_active,
            CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS is_mapped
        FROM DLX_2_projects p
        LEFT JOIN sheq_sites s
          ON p.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        ORDER BY is_mapped DESC, COALESCE(s.site_name, p.projectName)
    """)
    rows = db.execute(query).mappings().all()
    return [dict(r) for r in rows]


@app.get("/api/form-types")
def list_form_types(db: Session = Depends(get_db)):
    query = text("""
        SELECT
            template_name,
            type,
            COUNT(*) AS form_count,
            MIN(created) AS first_seen,
            MAX(modified) AS last_modified
        FROM DLX_2_forms
        WHERE deleted = 0 OR deleted IS NULL
        GROUP BY template_name, type
        ORDER BY form_count DESC
    """)
    rows = db.execute(query).mappings().all()
    result = []
    for r in rows:
        d = dict(r)
        meta = TEMPLATES_WITH_CUSTOM_REPORT.get(d["template_name"])
        d["has_custom_report"] = meta is not None
        d["display_name"] = meta["display"] if meta else d["template_name"]
        result.append(d)
    return result


@app.get("/api/forms")
def list_forms(
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
    site_id: Optional[list[str]] = Query(None),
    form_type: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    status: Optional[str] = Query(None),
    not_downloaded_only: bool = Query(False),
    mapped_only: bool = Query(True, description="When true, restrict to forms whose template has a registered custom report. Default true — most users want the downloadable subset."),
    limit: int = Query(500, le=2000),
):
    where = ["(f.deleted = 0 OR f.deleted IS NULL)"]
    params: dict = {}

    if site_id:
        where.append("f.projectId IN :site_ids")
        params["site_ids"] = tuple(site_id)
    if form_type:
        where.append("f.template_name = :form_type")
        params["form_type"] = form_type
    if date_from:
        where.append("DATE(f.created) >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where.append("DATE(f.created) <= :date_to")
        params["date_to"] = date_to
    if status:
        where.append("f.status = :status")
        params["status"] = status

    if mapped_only:
        # Filter at the SQL level so the LIMIT applies to the mapped subset,
        # not pre-truncated. Pulls live registry from the templates_userland
        # loader so any uploaded template auto-included.
        mapped_names = list(TEMPLATES_WITH_CUSTOM_REPORT.keys())
        if not mapped_names:
            return {
                "count": 0, "limit": limit, "filters": {
                    "site_id": site_id, "form_type": form_type,
                    "date_from": str(date_from) if date_from else None,
                    "date_to": str(date_to) if date_to else None,
                    "status": status, "not_downloaded_only": not_downloaded_only,
                    "mapped_only": True,
                },
                "forms": [],
            }
        ph = ",".join(f":mt{i}" for i, _ in enumerate(mapped_names))
        where.append(f"f.template_name IN ({ph})")
        for i, n in enumerate(mapped_names):
            params[f"mt{i}"] = n

    where_sql = " AND ".join(where) if where else "1=1"

    query = text(f"""
        SELECT
            f.formId, f.projectId, f.type, f.number, f.template_name,
            f.status, f.created, f.modified, f.createdBy_userId,
            u.firstName AS creator_first, u.lastName AS creator_last,
            COALESCE(s.site_name, p.projectName) AS site_display,
            s.sos_number,
            CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END AS is_mapped
        FROM DLX_2_forms f
        LEFT JOIN DLX_2_projects p
          ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s
          ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        LEFT JOIN DLX_2_users u
          ON f.createdBy_userId COLLATE utf8mb4_unicode_ci = u.userId COLLATE utf8mb4_unicode_ci
         AND f.projectId COLLATE utf8mb4_unicode_ci = u.projectId COLLATE utf8mb4_unicode_ci
        WHERE {where_sql}
        ORDER BY f.created DESC
        LIMIT :limit
    """)
    params["limit"] = limit
    rows = db.execute(query, params).mappings().all()

    form_ids = [r["formId"] for r in rows]
    downloads_by_form = {}
    if form_ids:
        placeholders = ",".join(f":f{i}" for i in range(len(form_ids)))
        dl_sql = text(f"""
            SELECT form_id,
                   MAX(downloaded_at) AS last_downloaded_at,
                   MAX(form_modified_at) AS last_dl_form_modified,
                   COUNT(*) AS download_count
            FROM downloads
            WHERE form_id IN ({placeholders})
            GROUP BY form_id
        """)
        bind = {f"f{i}": fid for i, fid in enumerate(form_ids)}
        for dr in app_db.execute(dl_sql, bind).mappings().all():
            downloads_by_form[dr["form_id"]] = dict(dr)

    results = []
    for r in rows:
        d = dict(r)
        dl = downloads_by_form.get(d["formId"])
        d["last_downloaded_at"] = dl["last_downloaded_at"] if dl else None
        d["download_count"] = dl["download_count"] if dl else 0
        d["modified_since_download"] = False
        if dl and dl.get("last_dl_form_modified") and d["modified"]:
            try:
                dl_ts = dl["last_dl_form_modified"]
                if isinstance(dl_ts, str):
                    dl_ts = datetime.fromisoformat(dl_ts)
                d["modified_since_download"] = d["modified"] > dl_ts
            except Exception:
                d["modified_since_download"] = False
        d["has_custom_report"] = d["template_name"] in TEMPLATES_WITH_CUSTOM_REPORT
        d["creator_name"] = " ".join(
            x.capitalize() for x in [d.get("creator_first") or "", d.get("creator_last") or ""] if x
        ).strip() or None
        results.append(d)

    if not_downloaded_only:
        results = [r for r in results if r["download_count"] == 0 or r["modified_since_download"]]

    return {
        "count": len(results),
        "limit": limit,
        "filters": {
            "site_id": site_id, "form_type": form_type,
            "date_from": str(date_from) if date_from else None,
            "date_to": str(date_to) if date_to else None,
            "status": status, "not_downloaded_only": not_downloaded_only,
        },
        "forms": results,
    }


@app.get("/api/forms/{form_id}/download")
def download_form(
    form_id: str,
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    try:
        pdf_bytes, filename, size_bytes = generate_report(db, form_id)
    except ReportError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Report generation failed: {e}")

    form_modified = db.execute(text(
        "SELECT modified FROM DLX_2_forms WHERE formId = :fid"
    ), {"fid": form_id}).scalar()

    dl = Download(
        form_id=form_id,
        form_modified_at=form_modified,
        trigger_type="single",
        file_size_bytes=size_bytes,
    )
    app_db.add(dl)
    app_db.commit()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Report-Size": str(size_bytes),
        },
    )


class BulkDownloadRequest(BaseModel):
    form_ids: list[str]


@app.post("/api/forms/bulk-download")
def bulk_download(
    req: BulkDownloadRequest,
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    if not req.form_ids:
        raise HTTPException(status_code=400, detail="form_ids must not be empty")
    if len(req.form_ids) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 forms per bulk download")

    buf = io.BytesIO()
    included: list[str] = []
    failures: list[dict] = []

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fid in req.form_ids:
            try:
                pdf_bytes, filename, size_bytes = generate_report(db, fid)
            except ReportError as e:
                failures.append({"form_id": fid, "error": str(e)})
                continue
            except Exception as e:
                failures.append({"form_id": fid, "error": f"generation failed: {e}"})
                continue

            zf.writestr(filename, pdf_bytes)

            form_modified = db.execute(text(
                "SELECT modified FROM DLX_2_forms WHERE formId = :fid"
            ), {"fid": fid}).scalar()
            app_db.add(Download(
                form_id=fid,
                form_modified_at=form_modified,
                trigger_type="bulk",
                file_size_bytes=size_bytes,
            ))
            included.append(fid)

    if not included:
        raise HTTPException(
            status_code=500,
            detail={"message": "No forms could be generated", "failures": failures},
        )

    app_db.commit()

    zip_bytes = buf.getvalue()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"forms_{ts}_{len(included)}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{zip_name}"',
            "X-Included-Count": str(len(included)),
            "X-Failed-Count": str(len(failures)),
        },
    )


# ---------------------------------------------------------------------------
# Search — top bar global search box
# ---------------------------------------------------------------------------

@app.get("/api/search")
def search(
    q: str = Query("", min_length=0, max_length=200),
    limit_per_kind: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """Cross-table substring search for the top bar.
    Returns up to N matches each from sites, forms, and templates.
    Hidden projects (per the Admin page) are filtered out — same UX rule
    as the Sites worklist."""
    q = q.strip()
    if len(q) < 2:
        return {"q": q, "sites": [], "forms": [], "templates": []}
    like = f"%{q}%"

    hidden_dalux_ids = {h.dalux_project_id for h in app_db.query(HiddenProject).all()}

    sites_raw = db.execute(text("""
        SELECT s.sos_number, s.site_name, s.sos_name, s.sector, s.client, s.dalux_id
        FROM sheq_sites s
        WHERE (s.sos_number LIKE :q OR s.site_name LIKE :q OR s.sos_name LIKE :q)
        ORDER BY
            CASE WHEN s.sos_number LIKE :exact THEN 0 ELSE 1 END,
            COALESCE(s.site_name, s.sos_name)
        LIMIT :n
    """), {"q": like, "exact": q + "%", "n": limit_per_kind * 2}).mappings().all()
    sites = [dict(s) for s in sites_raw if s.get("dalux_id") not in hidden_dalux_ids][:limit_per_kind]

    forms_raw = db.execute(text("""
        SELECT f.formId, f.number, f.template_name, f.status, f.created, f.projectId,
               COALESCE(s.site_name, p.projectName) AS site_display,
               s.sos_number, s.dalux_id
        FROM DLX_2_forms f
        LEFT JOIN DLX_2_projects p
          ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s
          ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        WHERE (f.deleted = 0 OR f.deleted IS NULL)
          AND (f.number LIKE :q OR f.formId LIKE :q)
        ORDER BY f.created DESC
        LIMIT :n
    """), {"q": like, "n": limit_per_kind * 2}).mappings().all()
    forms = [
        {k: v for k, v in dict(f).items() if k not in ("projectId", "dalux_id")}
        for f in forms_raw
        if f.get("dalux_id") not in hidden_dalux_ids and f.get("projectId") not in hidden_dalux_ids
    ][:limit_per_kind]

    templates = db.execute(text("""
        SELECT template_name, COUNT(*) AS form_count
        FROM DLX_2_forms
        WHERE (deleted = 0 OR deleted IS NULL)
          AND template_name LIKE :q
        GROUP BY template_name
        ORDER BY form_count DESC
        LIMIT :n
    """), {"q": like, "n": limit_per_kind}).mappings().all()

    return {
        "q": q,
        "sites": [dict(s) for s in sites],
        "forms": [dict(f) for f in forms],
        "templates": [dict(t) for t in templates],
    }


# ---------------------------------------------------------------------------
# Sync status — for the TopBar "last synced" indicator
# ---------------------------------------------------------------------------

@app.get("/api/sync-status")
def sync_status(db: Session = Depends(get_db)):
    """Most recent successful Dalux sync. Reads DLX_2_sync_log for the latest
    'forms_sync_complete' entry; falls back to the latest successful row.
    The frontend computes relative time and colour-codes against thresholds."""
    row = db.execute(text("""
        SELECT synced_at, endpoint, success, records_upserted
        FROM DLX_2_sync_log
        WHERE endpoint = 'forms_sync_complete'
        ORDER BY synced_at DESC
        LIMIT 1
    """)).mappings().first()

    if not row:
        # Fallback: last successful row of any kind
        row = db.execute(text("""
            SELECT synced_at, endpoint, success, records_upserted
            FROM DLX_2_sync_log
            WHERE success = 1
            ORDER BY synced_at DESC
            LIMIT 1
        """)).mappings().first()

    if not row:
        return {"last_synced_at": None, "endpoint": None, "ok": False}

    return {
        "last_synced_at": row["synced_at"].isoformat() if row["synced_at"] else None,
        "endpoint": row["endpoint"],
        "ok": bool(row["success"]),
        "records_upserted": row["records_upserted"],
    }


# ---------------------------------------------------------------------------
# Admin — project status (mapped / unmapped / hidden)
# ---------------------------------------------------------------------------

@app.get("/api/admin/projects")
def admin_list_projects(
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """Return all Dalux projects with derived status. Hidden state takes
    precedence over mapped/unmapped — explicit user action wins."""
    rows = db.execute(text("""
        SELECT
            p.projectId   AS dalux_project_id,
            p.projectName AS dalux_project_name,
            p.number      AS dalux_project_number,
            s.sos_number  AS sos_number,
            s.site_name   AS site_name
        FROM DLX_2_projects p
        LEFT JOIN sheq_sites s
          ON s.dalux_id COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        ORDER BY p.projectName
    """)).mappings().all()

    hidden_ids = {h.dalux_project_id for h in app_db.query(HiddenProject).all()}

    out = []
    for r in rows:
        d = dict(r)
        if d["dalux_project_id"] in hidden_ids:
            status = "hidden"
        elif d["sos_number"] is not None:
            status = "mapped"
        else:
            status = "unmapped"
        d["status"] = status
        out.append(d)
    return out


class _HideResponse(BaseModel):
    hidden: bool


@app.post("/api/admin/projects/{dalux_project_id}/hide", response_model=_HideResponse)
def admin_hide_project(
    dalux_project_id: str,
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """Idempotent hide. 404 if the project doesn't exist in DLX_2_projects."""
    exists = db.execute(text(
        "SELECT 1 FROM DLX_2_projects WHERE projectId = :pid LIMIT 1"
    ), {"pid": dalux_project_id}).first()
    if not exists:
        raise HTTPException(status_code=404, detail=f"Dalux project {dalux_project_id} not found")

    if not app_db.get(HiddenProject, dalux_project_id):
        app_db.add(HiddenProject(dalux_project_id=dalux_project_id))
        app_db.commit()
    return _HideResponse(hidden=True)


@app.post("/api/admin/projects/{dalux_project_id}/unhide", response_model=_HideResponse)
def admin_unhide_project(
    dalux_project_id: str,
    app_db: Session = Depends(get_app_db),
):
    """Idempotent unhide."""
    row = app_db.get(HiddenProject, dalux_project_id)
    if row is not None:
        app_db.delete(row)
        app_db.commit()
    return _HideResponse(hidden=False)