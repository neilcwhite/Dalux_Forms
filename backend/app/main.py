"""FastAPI application entry point."""
from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.config import settings
from app.database import get_db

app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.DEBUG,
)

@app.get("/")
def root():
    """Health check."""
    return {
        "app": settings.APP_NAME,
        "status": "running",
        "debug": settings.DEBUG,
    }

@app.get("/api/health/db")
def db_health(db: Session = Depends(get_db)):
    """Confirms DB connectivity and returns row counts."""
    result = {}
    for table in ["sheq_sites", "DLX_2_projects", "DLX_2_forms"]:
        count = db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
        result[table] = count
    return result

@app.get("/api/sites")
def list_sites(db: Session = Depends(get_db)):
    """
    Returns sites joined across sheq_sites and DLX_2_projects.
    Falls back to Dalux project name when no sheq_sites mapping exists.
    COLLATE clauses added because the two tables use different collations
    (utf8mb4_general_ci vs utf8mb4_unicode_ci) - see scope doc tech debt.
    """
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