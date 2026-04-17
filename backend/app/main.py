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
    "Weekly Safety inspection": {
        "code": "CS053",
        "display": "CS053 — Weekly Safety inspection",
    },
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


@app.get("/api/sites/form-summary")
def site_form_summary(
    db: Session = Depends(get_db),
    app_db: Session = Depends(get_app_db),
):
    """For each project: which custom-report templates are in use, total form count, and how many have never been downloaded."""
    if not TEMPLATES_WITH_CUSTOM_REPORT:
        return {}
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