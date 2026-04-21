"""CS208 Protective Coating Inspection Report — builder.

Dalux template_name (exact): "Protective Coating Inspection (Complete)"
Spencer form code: CS208
Family F — Technical Test Record.

Conformant with Spencer Dalux Report Design System v1.0. Sibling to cs053.py
and cs037.py — helpers, query patterns, and handler protocol deliberately
mirror cs053.py so the three files read as a set.
"""
from __future__ import annotations
import base64
import re
from pathlib import Path
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo
from sqlalchemy import text
from sqlalchemy.orm import Session
from jinja2 import Environment, FileSystemLoader, select_autoescape

TEMPLATE_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent / "static"

FORM_CODE = "CS208"
FORM_DESCRIPTION = "Protective Coating Inspection Report"


_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


def _to_london(utc_dt: Optional[datetime]) -> tuple[Optional[datetime], str]:
    """Convert naive-UTC (or aware) datetime to Europe/London.
    Returns (local_dt, 'GMT'|'BST')."""
    if utc_dt is None:
        return None, ""
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=ZoneInfo("UTC"))
    london = utc_dt.astimezone(ZoneInfo("Europe/London"))
    return london, london.tzname() or "GMT"


def _title_case(s: str) -> str:
    if not s:
        return ""
    parts = s.split()
    out = []
    for p in parts:
        if "'" in p:
            out.append("'".join(x.capitalize() for x in p.split("'")))
        elif "-" in p:
            out.append("-".join(x.capitalize() for x in p.split("-")))
        elif p.lower().startswith("mc") and len(p) > 2:
            out.append("Mc" + p[2:].capitalize())
        elif p.lower().startswith("mac") and len(p) > 3:
            out.append("Mac" + p[3:].capitalize())
        else:
            out.append(p.capitalize())
    return " ".join(out)


def _data_uri(path: Optional[Path]) -> Optional[str]:
    if not path or not path.exists():
        return None
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode()
    ext = path.suffix.lstrip(".").lower() or "png"
    if ext == "jpg":
        ext = "jpeg"
    return f"data:image/{ext};base64,{b64}"


def _find_asset(folder: Path, prefixes: list[str]) -> Optional[str]:
    if not folder.exists():
        return None
    for prefix in prefixes:
        matches = [
            f for f in folder.iterdir()
            if f.is_file()
            and f.name.startswith(prefix)
            and f.suffix.lower() in (".png", ".jpg", ".jpeg")
        ]
        if matches:
            return _data_uri(matches[0])
    return None


def _initials(fullname: str) -> str:
    parts = [p for p in (fullname or "").split() if p]
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    if len(parts) == 1 and parts[0]:
        return parts[0][:2].upper()
    return "??"


def _sanitise_site(s: Optional[str]) -> str:
    """Split first token (SO number) from the rest with an underscore, then
    strip non-alphanumerics within each part. Shared convention with CS053."""
    if not s:
        return ""
    parts = s.strip().split(None, 1)
    first = re.sub(r"[^A-Za-z0-9]", "", parts[0])
    if len(parts) == 1:
        return first
    rest = re.sub(r"[^A-Za-z0-9]", "", parts[1])
    if first and rest:
        return f"{first}_{rest}"
    return first or rest


def build_payload(db: Session, form_id: str) -> dict:
    """Extract data for form_id into the context dict expected by cs208.html.j2."""
    from app.reports.service import fetch_photo_to_cache

    form_row = db.execute(text("""
        SELECT f.formId, f.number, f.template_name, f.status,
               f.created, f.modified, f.createdBy_userId, f.projectId,
               p.projectName AS dalux_project_name,
               p.number AS dalux_project_num,
               s.site_name, s.sos_number
        FROM DLX_2_forms f
        LEFT JOIN DLX_2_projects p
          ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s
          ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        WHERE f.formId = :fid
    """), {"fid": form_id}).mappings().first()
    if not form_row:
        raise ValueError(f"Form {form_id} not found")

    project_id = form_row["projectId"]

    def resolve_user(uid: Optional[str]) -> dict:
        """Scoped by (userId, projectId) per §Data access rules. When
        firstName/lastName are both blank (see KNOWN_ISSUES §2), derive a
        display name from the email local-part."""
        if not uid:
            return {"initials": "—", "fullName": "", "email": ""}
        row = db.execute(text("""
            SELECT firstName, lastName, email FROM DLX_2_users
            WHERE userId COLLATE utf8mb4_unicode_ci = :uid COLLATE utf8mb4_unicode_ci
              AND projectId COLLATE utf8mb4_unicode_ci = :pid COLLATE utf8mb4_unicode_ci
            LIMIT 1
        """), {"uid": uid, "pid": project_id}).mappings().first()
        if not row:
            return {"initials": "??", "fullName": uid[:10], "email": ""}
        first = (row["firstName"] or "").strip()
        last = (row["lastName"] or "").strip()
        name = _title_case(f"{first} {last}".strip())
        email = (row["email"] or "").strip()
        if not name and "@" in email:
            local = email.split("@")[0]
            parts = re.split(r"[._-]+", local)
            name = _title_case(" ".join(p for p in parts if p))
        return {"initials": _initials(name), "fullName": name, "email": email}

    def resolve_company(cid: Optional[str]) -> str:
        """Try DLX_2_companies first; fall back to users (SHEQV2 stores user
        IDs in company-relation fields on some templates)."""
        if not cid:
            return ""
        row = db.execute(text(
            "SELECT name FROM DLX_2_companies "
            "WHERE companyId COLLATE utf8mb4_unicode_ci = :cid COLLATE utf8mb4_unicode_ci "
            "LIMIT 1"
        ), {"cid": cid}).mappings().first()
        if row and row["name"]:
            return row["name"]
        u = resolve_user(cid)
        return u["fullName"] or cid

    # --- Load UDFs -----------------------------------------------------------
    # Ordering caveat: KNOWN_ISSUES §1 — no reliable ordering column on
    # DLX_2_form_udfs. userDefinedFieldId gives deterministic (but not
    # semantically guaranteed) order for the repeated coating-log fields.
    udfs = db.execute(text("""
        SELECT userDefinedFieldId, field_key, field_set, field_name, description,
               value_index, value_text, value_date, value_datetime, value_number,
               value_reference_key, value_reference_value,
               value_relation_userId, value_relation_companyId
        FROM DLX_2_form_udfs
        WHERE formId = :fid
        ORDER BY userDefinedFieldId
    """), {"fid": form_id}).mappings().all()

    atts = db.execute(text("""
        SELECT attachmentId, udf_key, fileName, fileDownloadUrl, created
        FROM DLX_2_form_attachments
        WHERE formId = :fid
    """), {"fid": form_id}).mappings().all()

    def udf_val(row):
        if row is None:
            return None
        for col in ("value_text", "value_date", "value_datetime", "value_number", "value_reference_value"):
            v = row[col]
            if v not in (None, "", "NULL"):
                return v
        if row["value_relation_userId"]:
            return resolve_user(row["value_relation_userId"])["fullName"]
        if row["value_relation_companyId"]:
            return resolve_company(row["value_relation_companyId"])
        return None

    def single(field_name: str):
        matches = [u for u in udfs if u["field_name"] == field_name]
        return udf_val(matches[0]) if matches else None

    def multi(field_name: str, expected: int = 4) -> list:
        matches = sorted(
            (u for u in udfs if u["field_name"] == field_name),
            key=lambda u: u["userDefinedFieldId"],
        )
        vals = [udf_val(m) for m in matches]
        while len(vals) < expected:
            vals.append(None)
        return vals[:expected]

    # Ambiguously-scoped fields (DATA_CONTRACT §Ambiguously-scoped UDFs)
    calib_dates = [udf_val(u) for u in sorted(
        (u for u in udfs if u["field_name"] == "Calibration Date"),
        key=lambda x: x["userDefinedFieldId"],
    )]
    date_of_tests = [udf_val(u) for u in sorted(
        (u for u in udfs if u["field_name"] == "Date of Test"),
        key=lambda x: x["userDefinedFieldId"],
    )]
    substrate_conds = [udf_val(u) for u in sorted(
        (u for u in udfs if u["field_name"] == "Substrate Condition"),
        key=lambda x: x["userDefinedFieldId"],
    )]
    comments = [udf_val(u) for u in sorted(
        (u for u in udfs if u["field_name"] == "Comments"),
        key=lambda x: x["userDefinedFieldId"],
    )]

    def safe(lst, i):
        return lst[i] if i < len(lst) else None

    # --- Identifiers ---------------------------------------------------------
    ident = {
        "project_udf": single("Project"),
        "project_num": single("Project Number"),
        "client": single("Client"),
        "report_number": single("Report Number"),
        "component": single("Component"),
        "application_method": single("Application Method"),
        "specification": single("Specification"),
        "location": single("Location of Measurement"),
        "site_name": form_row["site_name"] or form_row["dalux_project_name"],
        "form_number": form_row["number"],
        "form_id": form_row["formId"],
        "status": form_row["status"],
        "created": form_row["created"],
    }

    # --- ISO test sections ---------------------------------------------------
    tests = [
        {
            "title": "Soluble Salt Test",
            "iso": "ISO 8502-6:2006",
            "params": [
                ("Solvent Used", single("Solvent Used")),
                ("Bressle Patch Batch Number", single("Bressle Patch Batch Number")),
                ("Volume of Solvent Used", single("Volume of Solvent Used")),
                ("Date of Test", safe(date_of_tests, 0)),
                ("Conductivity Type / Serial No.", single("Conductivity Type/Serial Number")),
                ("Calibration Date", safe(calib_dates, 0)),
                ("Total Contact Time", single("Total Contact Time")),
                ("Salt test mg / m²", single("Salt Test  mg/m2")),  # double space in Dalux field name
            ],
        },
        {
            "title": "Surface Profile Test",
            "iso": "ISO 8503-5:2017",
            "params": [
                ("Replica Tape Batch Number", single("Replica Tape Batch Number")),
                ("Location of Measurement", single("Location of Measurement")),
                ("Tape Date of Manufacture", single("Tape Date of Manufacture")),
                ("Date of Test", safe(date_of_tests, 1)),
                ("Micrometer Type / Serial No.", single("Micrometer Type/Serial Number")),
                ("Calibration Date", safe(calib_dates, 1)),
                ("Number of Tests", single("Number of Tests")),
                ("Surface Profile Measured", single("Average Surface Profile Measured (μm)")),
            ],
        },
        {
            "title": "Dust Test",
            "iso": "ISO 8502-3:2017",
            "params": [
                ("Adhesive Tape Used", single("Adhesive Tape Used")),
                ("Substrate Condition", safe(substrate_conds, 0)),
                ("Test Location", single("Test Location")),
                ("Date of Test", safe(date_of_tests, 2)),
                ("Dust Size Quantity", single("Dust Size Quantity")),
                ("Dust Size Class", single("Dust Size Class")),
            ],
        },
        {
            "title": "Dry Film Thickness Measurements",
            "iso": "ISO 19840:2012",
            "params": [
                ("DFT Gauge Type / Serial No.", single("DFT Gauge Type/Serial Number")),
                ("Surface Temperature", single("Surface Temperature")),
                ("Substrate Condition", safe(substrate_conds, 1)),
                ("Calibration Date", safe(calib_dates, 2)),
                ("Number of Readings", single("Number of Readings")),
                ("Correction Value Used", single("Correction Value Used")),
            ],
        },
        {
            "title": "Visual Assessment Post Blast",
            "iso": "ISO 8501-3:2007",
            "params": [
                ("Preparation Grade", single("Preparation Grade")),
            ],
        },
    ]

    # --- Coating log ---------------------------------------------------------
    # Coat 1-4 ordering: KNOWN_ISSUES §1 (ordered by userDefinedFieldId, not
    # guaranteed to match inspector's coat sequence).
    coating_groups = [
        {
            "header": None,
            "rows": [
                ("Start / Finish Time", multi("Start/Finish Time")),
                ("Date", multi("Date")),
                ("HA Item Number", multi("HA Item Number")),
                ("Paint Manufacturer", multi("Paint Manufacturer")),
                ("Product", multi("Product")),
            ],
        },
        {
            "header": "ENVIRONMENTAL",
            "rows": [
                ("Relative Humidity (%)", multi("Relative Humidity %")),
                ("Steel Temperature (°C)", multi("Steel Temperature °C")),
                ("Air Temperature (°C)", multi("Air Temperature °C")),
                ("Dew Point (°C)", multi("Dew Point °C")),
                ("Time", multi("Time")),
            ],
        },
        {
            # KNOWN_ISSUES §3: Dalux stores these as single-value fields even
            # though the paper form has one cell per coat. Shown in 1st Coat
            # column only; 2nd-4th blank.
            "header": "SURFACE",
            "rows": [
                ("Method of Preparation", [single("Method of Preperation"), None, None, None]),  # sic: 'Preperation' in Dalux
                ("Grade of Cleanliness", [single("Grade of Cleanliness"), None, None, None]),
                ("Profile Measured", [single("Average Surface Profile Measured (μm)"), None, None, None]),
                ("Abrasive Used", [single("Abrasive Used"), None, None, None]),
                ("Salt Test mg/m²", [single("Salt Test  mg/m2"), None, None, None]),
                ("Dust Size Class", [single("Dust Size Class"), None, None, None]),
            ],
        },
        {
            "header": "DRY FILM THICKNESS (μm)",
            "rows": [
                ("Minimum", multi("Minimum")),
                ("Maximum", multi("Maximum")),
                ("Average", multi("Average")),
            ],
        },
        {
            "header": None,
            "rows": [
                ("Batch Number — Base", multi("Batch Number - Base")),
                ("Batch Number — Agent", multi("Batch Number - Agent")),
                ("'B' Sample — Specific Gravity", multi("'B' Sample - Specific Gravity")),
                ("Holiday Test (Accept/Reject)", multi("Holiday Test (Accept/Reject)")),
                ("Applicator", multi("Applicator")),
                ("Inspector", multi("Inspector")),
            ],
        },
    ]

    # --- Sign-offs -----------------------------------------------------------
    signed_udfs = sorted(
        (u for u in udfs if u["field_name"] == "Signed"),
        key=lambda u: u["userDefinedFieldId"],
    )
    att_by_udf_key = {a["udf_key"]: a for a in atts}
    positions = multi("Position/Qualification")
    dates_started = multi("Date Started")
    dates_finished = multi("Date Finished")

    ROLES = ["Prepared by", "Reviewed by", "Prepared by", "Reviewed by"]
    PAGES = ["Test Record", "Test Record", "Coating Log", "Coating Log"]

    signoffs = []
    for i in range(4):
        udf = signed_udfs[i] if i < len(signed_udfs) else None
        att = att_by_udf_key.get(udf["field_key"]) if udf else None
        sig_local = None
        if att and att["fileName"]:
            sig_local = fetch_photo_to_cache(project_id, att["attachmentId"], att["fileDownloadUrl"])
        signoffs.append({
            "role": ROLES[i],
            "page": PAGES[i],
            "position": safe(positions, i),
            "date_started": safe(dates_started, i),
            "date_finished": safe(dates_finished, i),
            "signature_path": _data_uri(sig_local) if sig_local else None,
        })

    # --- Photos (inspection only — signatures excluded) ---------------------
    inspection_atts = [
        a for a in atts
        if a["fileName"] and not a["fileName"].lower().startswith("signature")
    ]
    udf_by_key = {u["field_key"]: u for u in udfs}
    photos = []
    for n, a in enumerate(inspection_atts, start=1):
        udf = udf_by_key.get(a["udf_key"])
        local = fetch_photo_to_cache(project_id, a["attachmentId"], a["fileDownloadUrl"])
        photos.append({
            "n": n,
            "filename": a["fileName"],
            "local_path": _data_uri(local) if local else None,
            "attached_to_field": udf["field_name"] if udf else "(unknown field)",
            "attached_to_value": udf_val(udf) if udf else None,
        })

    created_by = resolve_user(form_row["createdBy_userId"])

    logo_data_uri = _find_asset(STATIC_DIR, ["Spencer Group logo", "Spencer_Group_logo", "spencer_logo"])
    qr_data_uri = _find_asset(STATIC_DIR, ["CS208_"])

    return {
        "form_code": FORM_CODE,
        "form_description": FORM_DESCRIPTION,
        "template_name": form_row["template_name"],
        "ident": ident,
        "tests": tests,
        "coating_groups": coating_groups,
        "comments": comments,
        "signoffs": signoffs,
        "photos": photos,
        "creator_initials": created_by["initials"],
        "creator_fullname": created_by["fullName"],
        "qr_asset": qr_data_uri,
        "logo_asset": logo_data_uri,
    }


def render_html(payload: dict) -> str:
    template = _env.get_template("cs208.html.j2")
    return template.render(**payload)


def build_filename(db: Session, form_meta) -> str:
    """Filename: {yyyy-mm-dd}_CS208_{SiteSanitised}_{FormID}.pdf

    Date source: form.created (Europe/London). Unlike CS053, CS208 form
    numbers look like 'PaintInspection_1' — not globally unique across sites,
    so FormID is appended for traceability.
    """
    form_id = form_meta["formId"]
    created = form_meta.get("created")
    local, _ = _to_london(created)
    date_str = local.strftime("%Y-%m-%d") if local else "unknown-date"

    row = db.execute(text("""
        SELECT s.site_name AS sheq_name, p.projectName
        FROM DLX_2_forms f
        LEFT JOIN sheq_sites s
          ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        LEFT JOIN DLX_2_projects p
          ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        WHERE f.formId = :fid
    """), {"fid": form_id}).mappings().first()
    site_raw = None
    if row:
        site_raw = row["sheq_name"] or row["projectName"]
    site_clean = _sanitise_site(site_raw) or "site"

    return f"{date_str}_{FORM_CODE}_{site_clean}_{form_id}.pdf"
