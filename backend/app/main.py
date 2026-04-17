"""FastAPI application entry point."""
from datetime import date, datetime
from typing import Optional

from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, get_app_db, app_engine, AppBase
from app import models  # noqa: F401
from app.models import Download
from app.reports.service import generate_report, ReportError

app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.DEBUG,
)


@app.on_event("startup")
def startup_init_app_db():
    AppBase.metadata.create_all(bind=app_engine)


TEMPLATES_WITH_CUSTOM_REPORT = {
    "Weekly Safety inspection",  # CS053
}


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
        d["has_custom_report"] = d["template_name"] in TEMPLATES_WITH_CUSTOM_REPORT
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
    limit: int = Query(500, le=2000),
):
    where = ["(f.deleted = 0 OR f.deleted IS NULL)"]
    params = {}

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