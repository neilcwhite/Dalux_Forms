"""CS037 Permit to Undertake Hot Work — report builder.

Family B template (permit). Mirrors the cs053 module structure for service.py
integration: exports `build_payload(db, form_id)`, `render_html(payload)`, and
the optional `build_filename(db, form_meta)` for the CS037-specific filename
rule (validity-From date + site-sanitised + formId).

Site display uses `DLX_2_projects.projectName` rather than `sheq_sites.site_name`
(deviates from CS053 convention — matches the approved CS037 mock and keeps
the identifier grid tidy given the SOS number is already shown separately).
"""
from __future__ import annotations

import base64
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import text
from sqlalchemy.orm import Session

TEMPLATE_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent / "static"

# Part B precautions — fixed display order.
# Each tuple is (db_field_name, display_text). The DB key is verbatim (matches
# Dalux UDF field_name). The display text is the polished version from the
# approved mock (sentence-cased, consistent spacing around slashes etc.).
PART_B_PRECAUTIONS: list[tuple[str, str]] = [
    ("Sprinklers and/ or fire hose in service:",
     "Sprinklers and / or fire hose in service"),
    ("Portable fire extinguishers at site of work (State Type):",
     "Portable fire extinguishers at site of work (State Type)"),
    ("Cutting/ burning/ welding equipment in good repair:",
     "Cutting / burning / welding equipment in good repair"),
    ("Operator(s) competent and certification checked:",
     "Operator(s) competent and certification checked"),
    ("Area clear of combustible/ flammable materials (within 50ft) including dust, debris etc:",
     "Area clear of combustible / flammable materials (within 50 ft) including dust, debris etc."),
    ("Combustible surfaces made safe by screening, covering or other means:",
     "Combustible surfaces made safe by screening, covering or other means"),
    ("Flammable substances or liquids that cannot be moved, made safe:",
     "Flammable substances or liquids that cannot be moved, made safe"),
    ("Services in area identified and protected (gas, water, electricity, telephone, cabling etc.):",
     "Services in area identified and protected (gas, water, electricity, telephone, cabling etc.)"),
    ("All wall and floor openings covered:",
     "All wall and floor openings covered"),
    ("If work site is elevated, are precautions in place to prevent sparks etc. falling below or has access to the area below been restricted to make safe:",
     "If work site is elevated, are precautions in place to prevent sparks etc. falling below, or has access to the area below been restricted to make safe"),
    ("Screening or protect fellow workers or members of the public from sparks and/or exposure to welding arc etc:",
     "Screening or protect fellow workers or members of the public from sparks and / or exposure to welding arc etc."),
    ("Other processes that may be affected? State precautions taken:",
     "Other processes that may be affected? State precautions taken"),
    ("Is work taking place in confined space? State precautions taken:",
     "Is work taking place in confined space? State precautions taken"),
]

SIG_PERMIT_CONTROLLER_FN = "Signed by Permit Controller:"
SIG_PART_C_FN = "Signed (Person in Charge of Operations / Supervisor)"
SIG_PART_E_FN = "Signed"


def _size_class(text_val, mono: bool = False) -> str:
    """Auto-shrink tier ('' | 'len-md' | 'len-lg' | 'len-xl'). Matches the
    thresholds from the approved mock — calibrated for the 20/60/20 id-grid
    with 10.5pt base font."""
    if not text_val:
        return ""
    n = len(str(text_val))
    if mono:
        if n > 28:
            return "len-xl"
        if n > 20:
            return "len-lg"
        if n > 14:
            return "len-md"
    else:
        if n > 55:
            return "len-xl"
        if n > 40:
            return "len-lg"
        if n > 28:
            return "len-md"
    return ""


_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)
_env.filters["size_class"] = _size_class


def _title_case(s: str) -> str:
    if not s:
        return ""
    return " ".join(w.capitalize() for w in s.split() if w)


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


def _to_london(utc_dt: Optional[datetime]) -> tuple[Optional[datetime], str]:
    """Convert a naive-UTC (or aware) datetime to Europe/London. Returns
    (local_dt, 'GMT'|'BST'). Returns (None, '') if input is None."""
    if utc_dt is None:
        return None, ""
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=ZoneInfo("UTC"))
    london = utc_dt.astimezone(ZoneInfo("Europe/London"))
    return london, london.tzname() or "GMT"


def _fmt_validity(dt: Optional[datetime]) -> str:
    if not dt:
        return "—"
    return dt.strftime("%d %b %Y · %H:%M")


def _fmt_capture(dt: Optional[datetime]) -> str:
    if not dt:
        return ""
    return dt.strftime("%d %b %Y, %H:%M")


def _duration(from_dt: Optional[datetime], to_dt: Optional[datetime]) -> str:
    if not from_dt or not to_dt or to_dt < from_dt:
        return "—"
    total_minutes = int((to_dt - from_dt).total_seconds() // 60)
    h, m = divmod(total_minutes, 60)
    return f"{h}h {m}m"


def _status_chip(status: Optional[str], to_dt_utc: Optional[datetime]) -> tuple[str, str]:
    """Return (label, css_class) per the three-state rule: closed / open / expired."""
    if (status or "").lower() == "closed":
        return "Closed", "closed"
    now_utc = datetime.now(timezone.utc)
    if to_dt_utc:
        to_aware = to_dt_utc if to_dt_utc.tzinfo else to_dt_utc.replace(tzinfo=ZoneInfo("UTC"))
        if now_utc > to_aware:
            return "Expired", "expired"
    return "Open", "open"


def _sanitise_site(s: Optional[str]) -> str:
    """Strip all non-alphanumeric characters (spaces, hyphens, punctuation)."""
    return re.sub(r"[^A-Za-z0-9]", "", s or "")


def _resolve_user(db: Session, uid: Optional[str], project_id: str) -> dict:
    """Resolve a user to a display name via DLX_2_users, scoped by (userId, projectId).
    Prefers `name`; falls back to `firstName + ' ' + lastName`."""
    if not uid:
        return {"name": "", "initials": "??"}
    row = db.execute(text(
        "SELECT name, firstName, lastName FROM DLX_2_users "
        "WHERE userId COLLATE utf8mb4_unicode_ci = :uid COLLATE utf8mb4_unicode_ci "
        "AND projectId COLLATE utf8mb4_unicode_ci = :pid COLLATE utf8mb4_unicode_ci "
        "LIMIT 1"
    ), {"uid": uid, "pid": project_id}).mappings().first()
    if not row:
        return {"name": "(unknown)", "initials": "??"}
    name = (row["name"] or "").strip()
    if not name:
        fn = (row["firstName"] or "").strip()
        ln = (row["lastName"] or "").strip()
        name = _title_case(f"{fn} {ln}".strip())
    if not name:
        name = "(unknown)"
    parts = name.split()
    initials = ((parts[0][:1] + parts[-1][:1]) if len(parts) >= 2 else name[:2]).upper()
    return {"name": name, "initials": initials}


def _load_form_header(db: Session, form_id: str) -> dict:
    row = db.execute(text("""
        SELECT f.formId, f.projectId, f.number, f.template_name, f.status,
               f.created, f.modified,
               f.createdBy_userId, f.modifiedBy_userId,
               p.projectName, p.number AS proj_number,
               s.site_name AS sheq_name, s.sos_number AS sheq_sos
        FROM DLX_2_forms f
        LEFT JOIN DLX_2_projects p
          ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s
          ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        WHERE f.formId = :fid
    """), {"fid": form_id}).mappings().first()
    if not row:
        raise ValueError(f"Form {form_id} not found")
    return dict(row)


def build_payload(db: Session, form_id: str) -> dict:
    from app.reports.service import fetch_photo_to_cache

    meta = _load_form_header(db, form_id)
    project_id = meta["projectId"]

    # Display site from projectName (Option 1 per handoff); fall back to sheq
    # site_name, then a synthetic placeholder so the cell is never blank.
    site_name = meta["projectName"] or meta["sheq_name"] or f"(project {project_id[:12]})"
    project_num = meta["sheq_sos"] or meta["proj_number"] or "—"

    # All UDFs for the form in one trip
    udfs = db.execute(text("""
        SELECT field_name, field_key, field_set, description,
               value_text, value_date, value_datetime,
               value_number, value_reference_key, value_reference_value,
               value_relation_userId, value_relation_companyId
        FROM DLX_2_form_udfs WHERE formId = :fid
    """), {"fid": form_id}).mappings().all()

    # Attachments for the form (signatures live here)
    att_rows = db.execute(text("""
        SELECT attachmentId, udf_key, udf_set, fileName, fileDownloadUrl, created, modified
        FROM DLX_2_form_attachments
        WHERE formId = :fid AND deleted = 0
    """), {"fid": form_id}).mappings().all()
    att_index: dict[tuple, dict] = {}
    for a in att_rows:
        key = (a["udf_key"] or "", a["udf_set"] or "")
        att_index[key] = dict(a)

    # Split UDFs: singletons (empty field_set) vs repeating-group members (Part D)
    singles: dict[str, dict] = {}
    part_d_sets: dict[str, dict[str, dict]] = {}
    for u in udfs:
        rec = dict(u)
        fs = rec.get("field_set") or ""
        if fs:
            part_d_sets.setdefault(fs, {})[rec["field_name"]] = rec
        else:
            singles[rec["field_name"]] = rec

    # Header identifier values
    wpp_ms = (singles.get("WPP / MS No:") or {}).get("value_text") or ""
    permit_no = (singles.get("Permit No:") or {}).get("value_text") or ""
    from_dt_utc = (singles.get("From:") or {}).get("value_datetime")
    to_dt_utc = (singles.get("To:") or {}).get("value_datetime")

    # Timezone conversion — values stored UTC, rendered Europe/London
    from_dt_local, from_tz = _to_london(from_dt_utc)
    to_dt_local, to_tz = _to_london(to_dt_utc)
    validity_tz = from_tz or to_tz or "GMT"
    validity_offset = "+01:00" if validity_tz == "BST" else "+00:00"

    # Status chip
    status_label, status_cls = _status_chip(meta["status"], to_dt_utc)

    # Duration
    duration_str = _duration(from_dt_local, to_dt_local)

    # Part A
    part_a_desc = (singles.get("Description of Work and Location:") or {}).get("value_text") or ""
    part_a_equip = (singles.get("Details of Equipment to be used:") or {}).get("value_text") or ""

    # Part B — 13 precautions in fixed display order; missing UDFs render blank
    precautions = []
    pill_map = {"Yes": "yes", "No": "no", "N/A": "na"}
    for idx, (db_name, display_text) in enumerate(PART_B_PRECAUTIONS, start=1):
        rec = singles.get(db_name)
        state = (rec or {}).get("value_reference_value") or ""
        state = state.strip()
        precautions.append({
            "num": idx,
            "text": display_text,
            "state": state,
            "pill_class": pill_map.get(state, "blank"),
            "pill_label": state or "—",
        })

    # User resolution for creator / modifier (used as fallback signer + capture ts)
    creator = _resolve_user(db, meta["createdBy_userId"], project_id)
    modifier = _resolve_user(db, meta["modifiedBy_userId"], project_id)
    created_local, _ = _to_london(meta["created"])
    modified_local, _ = _to_london(meta["modified"])

    def _sig_section(field_name: str, fallback_user: dict,
                     fallback_ts_local: Optional[datetime]) -> dict:
        """Build a singleton signature payload (Permit Controller / Part C / Part E)."""
        rec = singles.get(field_name)
        name = ""
        if rec:
            name = (rec.get("description") or "").strip()
        if not name:
            name = fallback_user["name"] or "(unknown)"

        sig_src = None
        if rec:
            key = (rec.get("field_key") or "", "")
            att = att_index.get(key)
            if att:
                local = fetch_photo_to_cache(project_id, att["attachmentId"], att.get("fileDownloadUrl"))
                sig_src = _data_uri(local) if local else None

        return {
            "name": name,
            "sig_src": sig_src,
            "ts": _fmt_capture(fallback_ts_local),
        }

    sig_permit_controller = _sig_section(SIG_PERMIT_CONTROLLER_FN, creator, created_local)
    sig_part_c = _sig_section(SIG_PART_C_FN, modifier, modified_local)
    sig_part_e = _sig_section(SIG_PART_E_FN, modifier, modified_local)

    # Part D — repeating group keyed by field_set.
    # Note on key shape: UDF field_set is the form-id-prefixed version
    # ('S427377143454894080_20260219080633931-e6bb86cd'), but the matching
    # attachment's udf_set stores only the suffix ('20260219080633931-e6bb86cd').
    # Strip the '{form_id}_' prefix before looking up attachments.
    def _att_set_for(field_set: str) -> str:
        prefix = f"{form_id}_"
        return field_set[len(prefix):] if field_set.startswith(prefix) else field_set

    part_d_persons = []
    header_re = re.compile(r"^(\d+)\s+Permit controls accepted and understood by:$")
    for fs, rows in part_d_sets.items():
        n = None
        for fn in rows:
            m = header_re.match(fn)
            if m:
                n = int(m.group(1))
                break
        sig_rec = rows.get("Signature:")
        pos_rec = rows.get("Position:")

        signer_name = ""
        if sig_rec:
            signer_name = (sig_rec.get("description") or "").strip()
        if not signer_name:
            signer_name = "(unknown)"

        position = (pos_rec or {}).get("value_text") or "—"

        sig_src = None
        sig_missing = False
        if sig_rec:
            key = (sig_rec.get("field_key") or "", _att_set_for(fs))
            att = att_index.get(key)
            if att:
                local = fetch_photo_to_cache(project_id, att["attachmentId"], att.get("fileDownloadUrl"))
                sig_src = _data_uri(local) if local else None
                if sig_src is None:
                    sig_missing = True
            else:
                sig_missing = True

        part_d_persons.append({
            "num": n if n is not None else 0,
            "sort": n if n is not None else 9999,
            "name": signer_name,
            "position": position,
            "sig_src": sig_src,
            "sig_missing": sig_missing,
        })
    part_d_persons.sort(key=lambda p: p["sort"])

    # Assets
    qr_data_uri = _find_asset(STATIC_DIR, ["CS037_"])
    logo_data_uri = _find_asset(
        STATIC_DIR, ["Spencer Group logo", "Spencer_Group_logo", "spencer_logo"]
    )

    return {
        # Identity
        "form_id": meta["formId"],
        "form_number": meta["number"],
        "status": meta["status"],
        "status_label": status_label,
        "status_class": status_cls,
        # Header identifiers
        "site_name": site_name,
        "project_num": project_num,
        "permit_no": permit_no,
        "wpp_ms_no": wpp_ms,
        # Validity
        "from_display": _fmt_validity(from_dt_local),
        "to_display": _fmt_validity(to_dt_local),
        "from_tz": from_tz or validity_tz,
        "to_tz": to_tz or validity_tz,
        "duration": duration_str,
        "validity_tz_note": f"All times shown in {validity_tz} (UTC{validity_offset})",
        # Part A
        "part_a_description": part_a_desc,
        "part_a_equipment": part_a_equip,
        # Part B
        "precautions": precautions,
        # Signatures (Permit Controller + Parts C & E)
        "sig_permit_controller": sig_permit_controller,
        "sig_part_c": sig_part_c,
        "sig_part_e": sig_part_e,
        # Part D
        "part_d_persons": part_d_persons,
        # Provenance line
        "creator_name": creator["name"],
        "modifier_name": modifier["name"],
        "created_display": created_local.strftime("%d %b %Y") if created_local else "",
        "modified_display": modified_local.strftime("%d %b %Y") if modified_local else "",
        # Assets
        "qr_data_uri": qr_data_uri,
        "logo_data_uri": logo_data_uri,
    }


def render_html(payload: dict) -> str:
    template = _env.get_template("cs037.html.j2")
    return template.render(**payload)


def build_filename(db: Session, form_meta) -> str:
    """CS037 filename: {yyyy-mm-dd}_CS037_{SiteNameSanitised}_{formId}.pdf

    Date is the permit validity From (Europe/London), not form creation date.
    Fallback to form.created if the From UDF is missing. Site is projectName-first
    (same choice as display), sanitised to alphanumeric only.
    """
    form_id = form_meta["formId"]

    # Validity From date
    row = db.execute(text("""
        SELECT value_datetime FROM DLX_2_form_udfs
        WHERE formId = :fid AND field_name = 'From:'
          AND (field_set = '' OR field_set IS NULL)
        LIMIT 1
    """), {"fid": form_id}).mappings().first()
    from_dt = row["value_datetime"] if row else None
    if from_dt is None:
        from_dt = form_meta.get("created")
    date_local, _ = _to_london(from_dt)
    date_str = date_local.strftime("%Y-%m-%d") if date_local else "unknown-date"

    # Site name — projectName-first (Option 1)
    row = db.execute(text("""
        SELECT p.projectName, s.site_name AS sheq_name
        FROM DLX_2_forms f
        LEFT JOIN DLX_2_projects p
          ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s
          ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        WHERE f.formId = :fid
    """), {"fid": form_id}).mappings().first()
    site_raw = None
    if row:
        site_raw = row["projectName"] or row["sheq_name"]
    site_clean = _sanitise_site(site_raw) or "site"

    return f"{date_str}_CS037_{site_clean}_{form_id}.pdf"
