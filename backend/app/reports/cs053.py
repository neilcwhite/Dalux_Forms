"""CS053 Weekly Safety Inspection — report builder."""
from __future__ import annotations
import base64
import re
from pathlib import Path
from datetime import datetime
from typing import Optional
from sqlalchemy import text
from sqlalchemy.orm import Session
from jinja2 import Environment, FileSystemLoader, select_autoescape

TEMPLATE_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent / "static"

# Canonical CS053 category titles — used as fallback when a form's UDFs
# don't contain the category-header row (inspector didn't tick the parent
# category state, or sync dropped the row). These titles match the ones
# Dalux emits for the current CS053 template; verify against a known-good
# form if the template is ever revised upstream.
CS053_CATEGORY_TITLES = {
    1: "Safe Access/Egress & Place of Work (incl. lighting)",
    2: "Traffic Routes & Vehicles",
    3: "Site Order & Cleanliness",
    4: "Site Security / Protection of Public",
    5: "Excavations",
    6: "Overhead Cables & Underground Services",
    7: "Mobile Plant, Machinery & Equipment",
    8: "Work at Height",
    9: "Welfare",
    10: "Fire & Other Emergencies",
    11: "PPE (incl. RPE)",
    12: "Environment",
    13: "Quality",
    14: "Safety Systems & Culture",
}

_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


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


def _uk_date(iso) -> str:
    if not iso:
        return ""
    if isinstance(iso, datetime):
        return iso.strftime("%d/%m/%Y")
    try:
        y, m, d = str(iso).split("-")
        return f"{d[:2]}/{m}/{y}"
    except Exception:
        return str(iso)


def _data_uri(path: Path) -> Optional[str]:
    if not path.exists():
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


def build_payload(db: Session, form_id: str) -> dict:
    from app.reports.service import fetch_photo_to_cache

    form = db.execute(text(
        "SELECT f.formId, f.projectId, f.type, f.number, f.template_name, "
        "f.status, f.created, f.modified, "
        "f.createdBy_userId, f.modifiedBy_userId "
        "FROM DLX_2_forms f WHERE f.formId = :fid"
    ), {"fid": form_id}).mappings().first()
    if not form:
        raise ValueError(f"Form {form_id} not found")

    project_id = form["projectId"]

    def resolve_user(uid: Optional[str]) -> dict:
        if not uid:
            return {"initials": "??", "fullName": ""}
        row = db.execute(text(
            "SELECT firstName, lastName FROM DLX_2_users "
            "WHERE userId COLLATE utf8mb4_unicode_ci = :uid COLLATE utf8mb4_unicode_ci "
            "LIMIT 1"
        ), {"uid": uid}).mappings().first()
        if not row:
            return {"initials": "??", "fullName": uid[:10]}
        fn = (row["firstName"] or "").strip()
        ln = (row["lastName"] or "").strip()
        initials = ((fn[:1] + ln[:1]) or "??").upper()
        return {
            "initials": initials,
            "fullName": _title_case(f"{fn} {ln}".strip()),
        }

    created_by = resolve_user(form["createdBy_userId"])
    modified_by = resolve_user(form["modifiedBy_userId"])
    creator_differs = form["createdBy_userId"] != form["modifiedBy_userId"]

    # Site name and project number come from the project/site tables, not UDFs.
    # Dalux auto-populates them from project metadata; they aren't inspector-filled
    # fields and don't live in DLX_2_form_udfs. Prefer sheq_sites (Spencer's
    # master list with the proper SOS number) and fall back to DLX_2_projects
    # for unmapped Dalux projects so the header is never blank.
    site_row = db.execute(text("""
        SELECT
            COALESCE(s.site_name, p.projectName) AS site_name,
            COALESCE(s.sos_number, p.number)     AS project_num
        FROM DLX_2_forms f
        LEFT JOIN DLX_2_projects p
          ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s
          ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        WHERE f.formId = :fid
    """), {"fid": form_id}).mappings().first()
    site_name = (site_row["site_name"] if site_row else "") or ""
    project_num = (site_row["project_num"] if site_row else "") or ""

    meta_rows = db.execute(text(
        "SELECT field_name, value_text, value_date, value_relation_userId, "
        "value_relation_companyId, value_reference_value "
        "FROM DLX_2_form_udfs WHERE formId = :fid"
    ), {"fid": form_id}).mappings().all()

    insp_date = ""
    last_insp = ""
    inspector_uid = None
    accompanied_uids: list[str] = []
    company_ids: list[str] = []
    actions_closed = ""
    for r in meta_rows:
        fn = r["field_name"] or ""
        if fn == "Date" and r["value_date"]:
            insp_date = str(r["value_date"])
        elif fn == "Date of last inspection" and r["value_date"]:
            last_insp = str(r["value_date"])
        elif fn == "Inspection By" and r["value_relation_userId"]:
            inspector_uid = r["value_relation_userId"]
        elif fn == "Accompanied By" and r["value_relation_userId"]:
            accompanied_uids.append(r["value_relation_userId"])
        elif fn == "Companies Observed" and r["value_relation_companyId"]:
            company_ids.append(r["value_relation_companyId"])
        elif "actions been closed" in fn.lower() and r["value_reference_value"]:
            actions_closed = r["value_reference_value"]

    inspector_user = resolve_user(inspector_uid) if inspector_uid else created_by
    accompanied_names = [resolve_user(u)["fullName"] for u in accompanied_uids if u]
    company_names = []
    for cid in company_ids:
        row = db.execute(text(
            "SELECT name FROM DLX_2_companies "
            "WHERE companyId COLLATE utf8mb4_unicode_ci = :cid COLLATE utf8mb4_unicode_ci "
            "LIMIT 1"
        ), {"cid": cid}).mappings().first()
        if row and row["name"]:
            company_names.append(row["name"])

    state_rows = db.execute(text(
        "SELECT field_name, value_text, field_key "
        "FROM DLX_2_form_udfs "
        "WHERE formId = :fid AND value_text IN ('Green', 'Red', 'N/A') "
        "ORDER BY field_name"
    ), {"fid": form_id}).mappings().all()

    categories: dict[int, dict] = {}
    items_by_name: dict[str, dict] = {}
    for r in state_rows:
        fn = r["field_name"]
        vt = r["value_text"]
        m_item = re.match(r"^(\d+)\.(\d+):\s*(.+)$", fn)
        m_cat = re.match(r"^(\d+)\.\s+(.+)$", fn)
        if m_item:
            cat_num = int(m_item.group(1))
            sub_num = int(m_item.group(2))
            title = m_item.group(3)
            cat = categories.setdefault(cat_num, {"num": cat_num, "title": "", "state": None, "items": []})
            item = {
                "num": f"{cat_num}.{sub_num}", "sort": (cat_num, sub_num),
                "title": title, "state": vt, "field_name": fn,
                "field_key": r["field_key"], "photos": [], "findings": [],
            }
            cat["items"].append(item)
            items_by_name[fn] = item
        elif m_cat:
            cat_num = int(m_cat.group(1))
            cat = categories.setdefault(cat_num, {"num": cat_num, "title": "", "state": None, "items": []})
            cat["title"] = m_cat.group(2)
            cat["state"] = vt

    # Bug 2 fix: category-header UDF rows are excluded from state_rows when
    # value_text isn't Green/Red/N/A (e.g. inspector didn't tick the parent
    # category state). Pull them separately so we still get the title text.
    # If the header row is missing entirely (as it is on many NESY forms),
    # fall back to CS053_CATEGORY_TITLES below.
    cat_title_rows = db.execute(text(
        r"SELECT field_name, value_text FROM DLX_2_form_udfs "
        r"WHERE formId = :fid AND field_name REGEXP '^[0-9]+[.] +[A-Za-z]'"
    ), {"fid": form_id}).mappings().all()
    for r in cat_title_rows:
        m = re.match(r"^(\d+)\.\s+(.+)$", r["field_name"])
        if not m:
            continue
        cat_num = int(m.group(1))
        cat = categories.setdefault(cat_num, {"num": cat_num, "title": "", "state": None, "items": []})
        if not cat["title"]:
            cat["title"] = m.group(2)
        if r["value_text"] and cat["state"] is None:
            cat["state"] = r["value_text"]

    # Fill any category still missing a title from the canonical list.
    for cat in categories.values():
        if not cat["title"]:
            cat["title"] = CS053_CATEGORY_TITLES.get(cat["num"], f"Category {cat['num']}")

    for cat in categories.values():
        cat["items"].sort(key=lambda x: x["sort"])
        cat["green"] = sum(1 for i in cat["items"] if i["state"] == "Green")
        cat["red"] = sum(1 for i in cat["items"] if i["state"] == "Red")
        cat["na"] = sum(1 for i in cat["items"] if i["state"] == "N/A")
        cat["blank"] = 0

    att_rows = db.execute(text(
        "SELECT a.attachmentId, a.fileName, a.fileDownloadUrl, a.udf_key, a.created, "
        "u.field_name "
        "FROM DLX_2_form_attachments a "
        "LEFT JOIN DLX_2_form_udfs u "
        "ON a.udf_key = u.field_key AND a.formId = u.formId "
        "WHERE a.formId = :fid"
    ), {"fid": form_id}).mappings().all()

    insp_date_str = insp_date or (form["created"].strftime("%Y-%m-%d") if form["created"] else None)
    tasks = []
    if insp_date_str:
        tasks = db.execute(text(
            "SELECT taskId, number, subject, created "
            "FROM DLX_2_tasks "
            "WHERE projectId COLLATE utf8mb4_unicode_ci = :pid COLLATE utf8mb4_unicode_ci "
            "AND `usage` = 'SafetyIssue' AND DATE(created) = :d"
        ), {"pid": project_id, "d": insp_date_str}).mappings().all()

    findings: list[dict] = []
    evidence_by_finding: dict[str, list[int]] = {}
    for t in tasks:
        tudfs = db.execute(text(
            "SELECT field_name, value_reference_value, value_text "
            "FROM DLX_2_task_udfs WHERE taskId = :tid"
        ), {"tid": t["taskId"]}).mappings().all()
        tudf_map = {r["field_name"]: r["value_reference_value"] or r["value_text"] for r in tudfs}

        ch = db.execute(text(
            "SELECT fields_currentResponsible_userId "
            "FROM DLX_2_task_changes WHERE taskId = :tid AND action = 'assign' "
            "ORDER BY timestamp LIMIT 1"
        ), {"tid": t["taskId"]}).mappings().first()
        assignee = resolve_user(ch["fields_currentResponsible_userId"])["fullName"] if ch else ""

        closed = db.execute(text(
            "SELECT timestamp FROM DLX_2_task_changes "
            "WHERE taskId = :tid AND fields_status = 'closed' "
            "ORDER BY timestamp DESC LIMIT 1"
        ), {"tid": t["taskId"]}).mappings().first()
        closed_date = _uk_date(str(closed["timestamp"])[:10]) if closed else ""

        evidence = db.execute(text(
            "SELECT attachmentId, fileName, fileDownloadUrl, created "
            "FROM DLX_2_task_attachments WHERE taskId = :tid"
        ), {"tid": t["taskId"]}).mappings().all()

        f = {
            "number": t["number"], "subject": t["subject"],
            "item_ref": tudf_map.get("Safety category", ""),
            "severity": tudf_map.get("Severity", ""),
            "assignee": assignee, "closed_date": closed_date,
            "evidence": [dict(e) for e in evidence],
        }
        findings.append(f)
        evidence_by_finding.setdefault(f["number"], [])
        if f["item_ref"] in items_by_name:
            items_by_name[f["item_ref"]]["findings"].append(f)

    photo_counter = 0
    for cat in sorted(categories.values(), key=lambda c: c["num"]):
        for item in cat["items"]:
            for att in att_rows:
                if att["field_name"] == item["field_name"] and att["fileName"] and "signature" not in (att["fileName"] or "").lower():
                    photo_counter += 1
                    local = fetch_photo_to_cache(project_id, att["attachmentId"], att["fileDownloadUrl"])
                    item["photos"].append({
                        "photo_no": photo_counter,
                        "attachmentId": att["attachmentId"],
                        "created": str(att["created"])[:16] if att["created"] else "",
                        "local_src": _data_uri(local) if local else None,
                    })
    for f in findings:
        for e in f["evidence"]:
            photo_counter += 1
            local = fetch_photo_to_cache(project_id, e["attachmentId"], e["fileDownloadUrl"])
            e["photo_no"] = photo_counter
            e["local_src"] = _data_uri(local) if local else None
            evidence_by_finding[f["number"]].append(photo_counter)
        f["evidence_nos"] = evidence_by_finding.get(f["number"], [])

    all_photos = []
    for cat in sorted(categories.values(), key=lambda c: c["num"]):
        for item in cat["items"]:
            for p in item["photos"]:
                all_photos.append({
                    "photo_no": p["photo_no"], "item_num": item["num"],
                    "item_title": item["title"], "attachmentId": p["attachmentId"],
                    "created": p["created"], "src": "inspection",
                    "local_src": p["local_src"],
                })
    for f in findings:
        for e in f["evidence"]:
            all_photos.append({
                "photo_no": e["photo_no"], "item_num": f["number"],
                "item_title": f"{f['subject']} (evidence for {f['item_ref']})",
                "attachmentId": e["attachmentId"],
                "created": str(e["created"])[:16] if e["created"] else "",
                "src": "evidence",
                "local_src": e.get("local_src"),
            })

    dq_warnings = []
    for cat in categories.values():
        has_red = any(i["state"] == "Red" for i in cat["items"])
        if has_red and cat["state"] != "Red":
            dq_warnings.append(
                f"Category '{cat['title']}' header recorded as {cat['state']} but contains Red item(s)."
            )

    total_items = sum(len(c["items"]) for c in categories.values())
    total_green = sum(c["green"] for c in categories.values())
    total_red = sum(c["red"] for c in categories.values())
    total_na = sum(c["na"] for c in categories.values())

    logo_data_uri = _find_asset(STATIC_DIR, ["Spencer Group logo", "Spencer_Group_logo", "spencer_logo"])
    qr_data_uri = _find_asset(STATIC_DIR, ["CS053_"])

    return {
        "form_id": form["formId"],
        "form_number": form["number"],
        "status": form["status"],
        "site_name": site_name, "project_num": project_num,
        "insp_date": _uk_date(insp_date),
        "last_insp": _uk_date(last_insp),
        "inspector": inspector_user["fullName"] or created_by["fullName"],
        "inspector_initials": inspector_user["initials"] if inspector_user["initials"] != "??" else created_by["initials"],
        "accompanied": accompanied_names,
        "companies": company_names,
        "actions_closed": actions_closed,
        "modifier": modified_by["fullName"],
        "creator_differs": creator_differs,
        "categories": [categories[k] for k in sorted(categories.keys())],
        "findings": findings,
        "all_photos": all_photos,
        "dq_warnings": dq_warnings,
        "total_items": total_items, "total_green": total_green,
        "total_red": total_red, "total_na": total_na,
        "total_photos": len(all_photos),
        "logo_data_uri": logo_data_uri,
        "qr_data_uri": qr_data_uri,
    }


def render_html(payload: dict) -> str:
    template = _env.get_template("cs053.html.j2")
    return template.render(**payload)