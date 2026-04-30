# Spencer Form Template — Authoring Spec

**Audience:** A separate Claude Desktop project used by Neil to design new Spencer report templates. The output of that project is uploaded to the Dalux Forms portal.

**What this document is:** the complete contract for producing a working template. If your output follows this spec, the portal accepts the upload, registers it live, and starts rendering PDFs immediately — no code changes anywhere else, no rebuild.

**Self-contained:** Everything you need to know is in this document. You do not have access to the host codebase; this spec is the source of truth.

---

## 1. What you produce

For every new Spencer form template, produce **two required files plus one optional file**:

| File | Required | Purpose |
|---|---|---|
| `<form_code>.py` | ✅ | Python builder — pulls form data from the DB and shapes it for rendering |
| `<form_code>.html.j2` | ✅ | Jinja2 template — the visual layout, references CSS classes from the Spencer design system |
| `<form_code>_qr.png` (or `.jpg`) | optional | Page-corner QR code image to embed in the report header |

**`<form_code>` rules:** lowercase letters, digits, underscores. Convention is `cs<NNN>` matching Spencer's internal form-code register (e.g. `cs053`, `cs208`, `cs417`). The user uploading will tell you which code to use.

**File names:** the user uploads three flat files; the portal automatically slots them into a versioned folder (`templates_userland/<form_code>/v<N>/`). You do not need to think about versions — the portal increments them.

---

## 2. The Python builder — required exports

The portal imports your `.py` file via `importlib`. On import, it must expose the following module-level symbols. **Anything missing → upload rejected with a clear error.**

### 2.1 Required constants

```python
DALUX_TEMPLATE_NAME = "Weekly Safety inspection"
# The exact value of DLX_2_forms.template_name in the Dalux database for
# this form type. The portal uses this to route incoming forms to your
# handler. Get the exact string from Neil — case- and whitespace-sensitive.

FORM_CODE = "CS053"
# Short Spencer form code, uppercase. Used in PDF filenames, the admin UI,
# and the Teams notification cards. Once a FORM_CODE is established, its
# DALUX_TEMPLATE_NAME is locked — re-uploads with a different
# DALUX_TEMPLATE_NAME will be rejected.

FORM_DISPLAY = "CS053 — Weekly Safety inspection"
# Human-readable label for the Forms-page dropdown and Admin → Templates
# table. Free-form; convention is "{FORM_CODE} — {English description}".

VALID_FROM = "2026-04-30"
# ISO date (YYYY-MM-DD). The portal's resolver picks the highest-numbered,
# non-disabled version whose VALID_FROM ≤ form.created. So a CS053 form
# filled in January 2026 keeps rendering with the v1 it was filled in
# under, even after a v2 with VALID_FROM "2026-04-30" is uploaded.
# For a brand-new template, use today's date.
```

### 2.2 Required functions

```python
def build_payload(db, form_id: str) -> dict:
    """Fetch form data from MariaDB + SQLite, shape it into a context dict
    that the Jinja template will consume. Called once per PDF download."""

def render_html(payload: dict) -> str:
    """Render the Jinja template against the payload dict. Returns a complete
    HTML document as a string. The portal pipes this to WeasyPrint for PDF."""
```

### 2.3 Optional function

```python
def build_filename(db, form_meta) -> str:
    """Custom PDF filename. If omitted, a generic
    {yyyy-mm-dd}_{FORM_CODE}_{site_name}_{form_id}.pdf is generated.
    Most templates override this to use the inspection date or a similar
    semantic date instead of form.created."""
```

`form_meta` is a SQLAlchemy mapping with these keys: `formId`, `projectId`, `number`, `template_name`, `status`, `created`, `modified`, `createdBy_userId`, `modifiedBy_userId`, `site_display`, `sos_number`, `creator_first`, `creator_last`, `creator_email`.

---

## 3. Runtime helpers available to your code

Two helpers are provided by the host. Import them at the top of your `.py`:

```python
from app.templates_userland.runtime import make_env, qr_data_uri

# Module-level Jinja environment, pre-configured to:
#  - Find your <form_code>.html.j2 in the same folder as this .py
#  - Find the shared `_spencer_design_system.css.j2` partial for {% include %}
_env = make_env(__file__)

# Returns a `data:image/...;base64,...` URI for the QR image you uploaded
# alongside this template, or None if no QR was uploaded for this version.
_qr = qr_data_uri(__file__)
```

You do not write the Jinja env yourself; always use `make_env(__file__)`.

---

## 4. Database access

Two databases. **You only read; you never write.**

### 4.1 MariaDB (Dalux + SHEQ data) — passed in as `db`

The `build_payload(db, form_id)` parameter is a SQLAlchemy `Session` connected to MariaDB. Use it like:

```python
from sqlalchemy import text

row = db.execute(text("""
    SELECT f.formId, f.number, f.status, f.created, f.modified,
           f.createdBy_userId
    FROM DLX_2_forms f
    WHERE f.formId = :fid
"""), {"fid": form_id}).mappings().first()
# row is a dict-like; row["formId"] etc.
```

**Always use `.mappings()` for dict-style access** (`.first()` for one row, `.all()` for multiple).

### 4.2 The COLLATE rule (non-negotiable)

Every cross-table join needs explicit collation hints on **both sides** of the equality. The Dalux tables and the SHEQ tables have different default collations and joining without explicit hints throws "Illegal mix of collations":

```sql
LEFT JOIN sheq_sites s
  ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
```

This applies to **every** join across `DLX_2_forms` ↔ `DLX_2_projects` ↔ `sheq_sites` ↔ `DLX_2_users` ↔ `DLX_2_companies`. Forget it once and the query 500s.

### 4.3 SQLite (app-local audit/state) — `app_db` is **not** passed to handlers

Your handler doesn't directly read SQLite. The portal handles download tracking, dedup, audit, etc. You should never need this.

---

## 5. Data model — what's where

### 5.1 `DLX_2_forms` — one row per form

| Column | Type | Notes |
|---|---|---|
| formId | string PK | `S<digits>` format, e.g. `S436856085521893376` |
| projectId | string | FK to `DLX_2_projects.projectId` (and `sheq_sites.dalux_id` via COLLATE) |
| type | string | Form type code |
| number | string | Sequence within project — e.g. `CS053_15` or `PaintInspection_1` |
| template_name | string | Matches your `DALUX_TEMPLATE_NAME` |
| status | string | `"open"`, `"closed"`, etc. |
| created | datetime | When the inspector first submitted |
| modified | datetime | Last edit. Equals created unless the form was re-opened |
| createdBy_userId | string | FK to `DLX_2_users.userId` |
| modifiedBy_userId | string | FK to `DLX_2_users.userId` |
| deleted | int (0/1) | Filter with `(deleted = 0 OR deleted IS NULL)` |

### 5.2 `DLX_2_form_udfs` — the form's actual answers

This is where every inspector-entered field lives. **One row per (form, field-instance).** A field can appear multiple times if the form's UI has repeating sections.

| Column | Type | Notes |
|---|---|---|
| formId | string FK | |
| userDefinedFieldId | string | Stable per row. **Use this for ordering** repeated fields |
| field_key | string | Unique key within form |
| field_set | string | Section label (often blank in older forms) |
| field_name | string | Display label, e.g. `"Risk Assessment"`, `"Signed"`, `"Date"` |
| description | string | Optional extra info |
| value_index | int | **Always 0** in current data. Don't rely on it for ordering |
| value_text | string \| null | Text answers |
| value_date | date \| null | Date answers |
| value_datetime | datetime \| null | Datetime answers |
| value_number | decimal \| null | Numeric answers |
| value_reference_key | string \| null | Reference-list key |
| value_reference_value | string \| null | Reference-list label, e.g. `"Yes"` / `"No"` / `"N/A"` |
| value_relation_userId | string \| null | FK to `DLX_2_users.userId` (e.g. inspector lookup) |
| value_relation_companyId | string \| null | FK to `DLX_2_companies.companyId` |

**The "pick the populated value" pattern:**

```python
def udf_value(row):
    for col in ("value_text", "value_date", "value_datetime", "value_number", "value_reference_value"):
        v = row[col]
        if v not in (None, "", "NULL"):
            return v
    if row["value_relation_userId"]:
        return resolve_user(row["value_relation_userId"])["fullName"]
    if row["value_relation_companyId"]:
        return resolve_company(row["value_relation_companyId"])
    return None
```

### 5.3 Repeated UDFs (multi-instance fields)

If the form has a coating log with 4 coats, you'll see 4 rows in `DLX_2_form_udfs` all with `field_name = "Date"`. Sort by `userDefinedFieldId` for **stable but not semantically guaranteed** order — there is no reliable way to know which instance is coat 1 vs coat 2 without inspector cross-reference. CS208's `KNOWN_ISSUES.md` documents this; treat as a known limitation:

```python
matches = sorted(
    (u for u in udfs if u["field_name"] == "Date"),
    key=lambda u: u["userDefinedFieldId"],
)
```

### 5.4 `DLX_2_form_attachments` — photos and signatures

| Column | Type | Notes |
|---|---|---|
| attachmentId | string PK | |
| formId | string FK | |
| udf_key | string | Joins to `DLX_2_form_udfs.field_key` (which UDF this attachment is on) |
| fileName | string | Filename. `signature.png` for sign-off images, anything else = inspection photo |
| fileDownloadUrl | string | Dalux URL, requires `X-API-KEY` header |
| created, modified | datetime | |

**Pattern: photo-cache fetching** (the portal manages the download with auth):

```python
from app.reports.service import fetch_photo_to_cache

local_path = fetch_photo_to_cache(project_id, attachment["attachmentId"], attachment["fileDownloadUrl"])
# local_path is a pathlib.Path or None if fetch failed
```

Then convert to a data URI for the template:

```python
import base64
from pathlib import Path

def data_uri(path):
    if not path or not path.exists():
        return None
    data = path.read_bytes()
    ext = path.suffix.lstrip(".").lower() or "png"
    if ext == "jpg":
        ext = "jpeg"
    return f"data:image/{ext};base64,{base64.b64encode(data).decode()}"
```

### 5.5 `DLX_2_projects` — Dalux's view of projects

| Column | Type | Notes |
|---|---|---|
| projectId | string PK | |
| projectName | string | |
| number | string | |
| address, created, closing, modules | various | |

### 5.6 `sheq_sites` — Spencer's master site list

| Column | Type | Notes |
|---|---|---|
| sos_number | string | The Spencer SOS code, e.g. `C2130` |
| site_name | string | Spencer-canonical name |
| sos_name | string | Alternative name |
| sector | string | `"Build & Civils"`, `"Bridges"`, `"Rail"`, `"M&E"`, etc. |
| client | string | |
| status | string | `"Active"`, etc. |
| dalux_id | string | The join key against `DLX_2_forms.projectId` and `DLX_2_projects.projectId` |
| dalux_active | string | |
| primary_contact | string | |
| start_on_site_date, finish_on_site_date | date | |

### 5.7 The "sheq-first" rule for site identity

Always prefer `sheq_sites.site_name` over `DLX_2_projects.projectName`. Use `LEFT JOIN` so unmapped Dalux projects still get a fallback:

```sql
SELECT
    COALESCE(s.site_name, p.projectName) AS site_display,
    COALESCE(s.sos_number, p.number)     AS project_num
FROM DLX_2_forms f
LEFT JOIN DLX_2_projects p
  ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
LEFT JOIN sheq_sites s
  ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
WHERE f.formId = :fid
```

### 5.8 `DLX_2_users` — composite-PK lookup by (userId, projectId)

| Column | Type | Notes |
|---|---|---|
| userId | string | Part of composite PK |
| projectId | string | Other part of composite PK — same user can appear once per project |
| name | string | Often blank |
| firstName, lastName | string | Often blank — fall back to email-local-part if so |
| email | string | |

**The user-resolution pattern** (handles blank-name fallback):

```python
def resolve_user(uid):
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
    last  = (row["lastName"] or "").strip()
    name  = title_case(f"{first} {last}".strip())
    email = (row["email"] or "").strip()
    if not name and "@" in email:
        # Derive a name from email local-part, e.g. neil.white@... → "Neil White"
        local = email.split("@")[0]
        parts = re.split(r"[._-]+", local)
        name = " ".join(p.capitalize() for p in parts if p)
    return {"initials": initials_of(name), "fullName": name, "email": email}
```

Always scope by `(userId, projectId)` — same `userId` may exist in multiple projects with different details.

### 5.9 `DLX_2_companies` — for company-relation UDFs

```python
def resolve_company(cid):
    if not cid:
        return ""
    row = db.execute(text(
        "SELECT name FROM DLX_2_companies "
        "WHERE companyId COLLATE utf8mb4_unicode_ci = :cid COLLATE utf8mb4_unicode_ci LIMIT 1"
    ), {"cid": cid}).mappings().first()
    if row and row["name"]:
        return row["name"]
    # Fallback: SHEQv2 sometimes stores user IDs in company-relation fields
    u = resolve_user(cid)
    return u["fullName"] or cid
```

---

## 6. The Jinja template — design system

### 6.1 Including the Spencer design system

Always include the shared partial at the top of your `<style>` block. It defines tokens, page setup, typography, and shared components:

```html
<style>
  {% include '_spencer_design_system.css.j2' %}

  /* Template-specific CSS below this line.
     Inherit from the partial; only define local rules where needed. */
  .my-template-class { ... }
</style>
```

### 6.2 Available CSS tokens

The only colours allowed in any template:

| Token | Hex | Use for |
|---|---|---|
| `--spencer-blue` | `#233E99` | Primary brand — section bands, box edges, title |
| `--ok-green` | `#2E7D4F` | Positive / closed / Yes |
| `--err-red` | `#C0392B` | Negative / expired / No / Red |
| `--na-grey` | `#8A8A8A` | Not applicable / neutral |
| `--amber` | `#B26500` | Open-but-still-valid / data-quality warning |
| `--text` | `#1A1A1A` | Body text |
| `--text-muted` | `#555` | Labels, captions, footer |
| `--bg-alt` | `#FAFBFD` | Panel / alternating row backgrounds |
| `--divider` | `#233E99` | Structural borders |
| `--divider-soft` | `#D8DCE6` | Soft row dividers and rules |

Use them via `var(--spencer-blue)` etc. **Never introduce a new colour locally.**

### 6.3 Available CSS components (shared classes from the partial)

- `.page-footer` — running footer with email + page number
- `.header-band` — top doc header (QR + title + logo)
- `.qr-cell`, `.title-cell`, `.logo-cell` — cells inside the band
- `.id-grid` — 3-column identifier grid (label / value / label / value layout)
- `.id-label`, `.id-value` — cell labels and values; `.id-value.mono` for IDs
- `.id-value.len-md/lg/xl` — auto-shrink classes for long values
- `.status-chip.closed/open/expired` — coloured status pills
- `.validity-block`, `.validity-head`, `.validity-body` — validity-window display
- `.section-head`, `.section-body` — section banner + content area
- `.sig-block`, `.sig-img`, `.sig-caption` — sign-off block

### 6.4 Page setup (already done by the partial)

A4, 10mm/15mm margins, footer placeholder. You don't override this.

### 6.5 WeasyPrint constraints (the renderer)

- **No JavaScript.** WeasyPrint is HTML+CSS → PDF only.
- **No CSS variables in inline `style=` attributes** before the `:root` declaration. Either put colour vars in a `<style>` block (which is what the partial does) or use hex directly in inline styles.
- **Limited CSS.** Most layout works (flexbox, grid, tables); a few advanced features don't (some custom-property edge cases, some `:has()`).
- **Page-break control:** `page-break-inside: avoid` on cards/sections you don't want split. Use `page-break-before: always` between major sections that should start on new pages.
- **Images** must be data URIs (base64) embedded in the HTML. The portal does this for you via the `data_uri()` helper above.

### 6.6 Standard structure

```jinja
<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<title>{{ form_code }} — {{ site_name }} — {{ insp_date }}</title>
<style>
  {% include '_spencer_design_system.css.j2' %}

  /* Template-specific CSS goes here */
</style>
</head>
<body>

<!-- Running footer (rendered on every page) -->
<div class="page-footer" style="position: running(pageFooter);">
  <div class="row">
    <div class="left">
      <div class="line1">{{ form_display }}</div>
      <div class="email">{{ footer_email }}</div>
    </div>
    <div class="right pageno"></div>
  </div>
</div>

<!-- Top header band (QR + title + Spencer logo) -->
<table class="header-band"><tr>
  <td class="qr-cell">
    {% if qr_data_uri %}<img src="{{ qr_data_uri }}" alt="QR">{% endif %}
  </td>
  <td class="title-cell">
    <div class="doc-title">{{ form_code }} — {{ form_display_short }}</div>
    <!-- subtitle / date / etc. -->
  </td>
  <td class="logo-cell">
    {% if logo_data_uri %}<img src="{{ logo_data_uri }}" alt="Spencer Group">{% endif %}
  </td>
</tr></table>

<!-- Identifier grid -->
<table class="id-grid">
  <tr>
    <td><div class="id-label">Site</div><div class="id-value">{{ site_name }}</div></td>
    <td><div class="id-label">SOS no.</div><div class="id-value mono">{{ sos_number }}</div></td>
    <!-- more identifiers... -->
  </tr>
</table>

<!-- Sections (one per logical area of the form) -->
<div class="section">
  <div class="section-head">Section title</div>
  <div class="section-body">
    <!-- section-specific markup -->
  </div>
</div>

<!-- Sign-off block -->
<div class="sig-block">...</div>

</body>
</html>
```

---

## 7. Versioning & filenames

### 7.1 Versioning is automatic

Each upload becomes a new immutable version. The portal slots your upload into `templates_userland/<form_code>/v<N>/` automatically. **You don't pick the version number.** If you re-upload the same `FORM_CODE` later, it becomes `v2`, then `v3`, etc.

The resolver picks the right version per form: highest-numbered, non-disabled version with `VALID_FROM ≤ form.created`. Older forms keep rendering with the version in force when they were submitted.

### 7.2 Filename pattern

The default filename is `{date}_{FORM_CODE}_{site}_{form_id}.pdf`. Most templates override `build_filename` to use a more semantic date (e.g. inspection date) and a cleaner site format. CS053 example:

```python
def build_filename(db, form_meta) -> str:
    """Filename: {yyyy-mm-dd}_CS053_{SiteSanitised}.pdf"""
    form_id = form_meta["formId"]

    # Inspection date — the 'Date' UDF if set, else form.created
    row = db.execute(text("""
        SELECT value_date FROM DLX_2_form_udfs
        WHERE formId = :fid AND field_name = 'Date' LIMIT 1
    """), {"fid": form_id}).mappings().first()
    insp_dt = row["value_date"] if row else None
    date_str = str(insp_dt)[:10] if insp_dt else form_meta["created"].strftime("%Y-%m-%d")

    # Site name — sheq-first
    row = db.execute(text("""
        SELECT s.site_name AS sheq_name, p.projectName
        FROM DLX_2_forms f
        LEFT JOIN sheq_sites s ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        LEFT JOIN DLX_2_projects p ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        WHERE f.formId = :fid
    """), {"fid": form_id}).mappings().first()
    site_raw = (row["sheq_name"] or row["projectName"]) if row else "site"

    # Split first token (SO number) with underscore: "C2144 FRB Lateral Thrust" → "C2144_FRBLateralThrust"
    parts = (site_raw or "").strip().split(None, 1)
    first = re.sub(r"[^A-Za-z0-9]", "", parts[0]) if parts else ""
    rest  = re.sub(r"[^A-Za-z0-9]", "", parts[1]) if len(parts) > 1 else ""
    site_clean = f"{first}_{rest}" if first and rest else (first or rest or "site")

    return f"{date_str}_CS053_{site_clean}.pdf"
```

---

## 8. Validation rules — what gets rejected

Your upload is rejected (with the reason returned to the user) if:

- The `.py` fails to import (syntax error, import error, etc.)
- Any required attribute is missing (`DALUX_TEMPLATE_NAME`, `FORM_CODE`, `FORM_DISPLAY`, `VALID_FROM`, `build_payload`, `render_html`)
- `build_payload` or `render_html` isn't callable
- `VALID_FROM` isn't a valid ISO date (`YYYY-MM-DD`)
- `FORM_CODE` is set to `cs053` / `cs037` / `cs208` (the three built-in form codes are protected — uploads can add new versions on top of them but never via colliding `FORM_CODE`)
- An uploaded handler claims a `DALUX_TEMPLATE_NAME` that conflicts with an already-established one for the same `FORM_CODE`
- The QR file (if provided) has an extension other than `.png` / `.jpg` / `.jpeg`
- The `.py` file's top-level code raises an exception during the validation import

**Crashes at render time** (not import time) are not rejected at upload — they show as 500s when someone tries to download a PDF for that form. Other forms keep working. Validate locally before uploading.

---

## 9. The canonical example: CS208 (Protective Coating Inspection)

This is the most recently built built-in template. It's a good model — it covers the full surface of the spec: multi-section identifiers, ISO test sections, multi-instance UDFs, sign-offs, photo appendix, and a custom filename. **Open and read CS208 end-to-end before authoring a new template.**

Skeleton (full file is ~480 lines; this shows the structure):

```python
"""CS208 Protective Coating Inspection Report — builder."""
from __future__ import annotations
import base64, re
from pathlib import Path
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.templates_userland.runtime import make_env, qr_data_uri

DALUX_TEMPLATE_NAME = "Protective Coating Inspection (Complete)"
FORM_CODE = "CS208"
FORM_DISPLAY = "CS208 — Protective Coating Inspection Report"
VALID_FROM = "2026-01-01"

_env = make_env(__file__)


def build_payload(db: Session, form_id: str) -> dict:
    from app.reports.service import fetch_photo_to_cache

    # 1. Form + project + site row
    form_row = db.execute(text("""
        SELECT f.formId, f.number, f.template_name, f.status, f.created, f.modified,
               f.createdBy_userId, f.projectId,
               p.projectName AS dalux_project_name,
               s.site_name, s.sos_number, s.client
        FROM DLX_2_forms f
        LEFT JOIN DLX_2_projects p ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
        LEFT JOIN sheq_sites s ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
        WHERE f.formId = :fid
    """), {"fid": form_id}).mappings().first()
    if not form_row:
        raise ValueError(f"Form {form_id} not found")

    project_id = form_row["projectId"]

    # 2. UDFs + attachments
    udfs = db.execute(text("""
        SELECT userDefinedFieldId, field_key, field_name, value_text, value_date,
               value_datetime, value_number, value_reference_value,
               value_relation_userId, value_relation_companyId
        FROM DLX_2_form_udfs WHERE formId = :fid
        ORDER BY userDefinedFieldId
    """), {"fid": form_id}).mappings().all()

    atts = db.execute(text("""
        SELECT attachmentId, udf_key, fileName, fileDownloadUrl
        FROM DLX_2_form_attachments WHERE formId = :fid
    """), {"fid": form_id}).mappings().all()

    # 3. Helpers (resolve_user, udf_val, single, multi) — see CS208 full source

    # 4. Shape the context (identifiers, tests, coating log, signoffs, photos)

    # 5. Embed the QR uploaded with this version
    return {
        "form_code": FORM_CODE,
        "form_display": FORM_DISPLAY,
        "ident": {...},
        "tests": [...],
        "signoffs": [...],
        "photos": [...],
        "qr_data_uri": qr_data_uri(__file__),
        # ... etc
    }


def render_html(payload: dict) -> str:
    template = _env.get_template(f"{FORM_CODE.lower()}.html.j2")
    return template.render(**payload)


def build_filename(db: Session, form_meta) -> str:
    """{date}_CS208_{site}_{form_id}.pdf — form.created as the date anchor."""
    # ... see §7.2 for the pattern
```

The matching `cs208.html.j2` runs ~520 lines and uses the design system classes from §6.3 throughout. The structure follows §6.6.

---

## 10. Pre-upload checklist

Before handing files to the portal, verify:

1. **Both files compile.** Open the `.py` in any Python REPL and try to import it manually (you'll need a stub `from app.templates_userland.runtime import make_env, qr_data_uri` in your environment; the portal provides the real one).
2. **All four constants are at module level** and string-typed. `VALID_FROM` parses with `date.fromisoformat()`.
3. **`build_payload` and `render_html` are top-level functions**, not nested inside classes or `if __name__ == ...` guards.
4. **Every `text("...")` query** that joins across `DLX_2_*` ↔ `sheq_sites` has `COLLATE utf8mb4_unicode_ci` on **both sides** of the equality.
5. **`render_html` uses `_env.get_template("<form_code>.html.j2")`** — the filename matches your `FORM_CODE` lowercased.
6. **The Jinja template `{% include '_spencer_design_system.css.j2' %}`** at the top of its `<style>` block.
7. **No new colours.** Only the tokens listed in §6.2.
8. **No JavaScript** in the `.html.j2`.
9. **No `print()` calls** at module level (they show up in the server log on every request — use `logging` if you must).
10. **All photo URLs are data URIs**, not external links — WeasyPrint can fetch external HTTP, but it slows rendering and makes offline-archive PDFs impossible.

If you can run the handler against a real form locally and the PDF renders, you're good. Otherwise: trust the validation gate and read the rejection reason if it comes back.

---

## 11. What you do **not** do

- **Don't write to the database.** The handler is read-only. Any data you need persisted goes in your handler's logic via the existing audit tables, which are managed by the portal — you have no way to write them and shouldn't try.
- **Don't `import` from `app.main`, `app.dashboard`, or `app.notifications`.** Those are app-level concerns, not handler-level. You only need `app.reports.service.fetch_photo_to_cache` and `app.templates_userland.runtime.{make_env, qr_data_uri}`.
- **Don't catch and swallow exceptions broadly.** A render failure should bubble up so the portal can return a 500 and log it. Targeted `try/except` for known issues (e.g. malformed photo URL) is fine.
- **Don't introduce new pip packages.** The portal's image has a fixed dependency set; uploaded handlers can only use what's already there. If you need a new library, that's a Docker rebuild and an IT signoff — out of scope for an upload.

---

## 12. What to ask Neil if you don't know

The Claude Desktop project has access to Neil but not the database. Ask him:

- The exact value of `template_name` in Dalux for the form type
- The Spencer `FORM_CODE` to use
- A representative `formId` to test against (he can pull one from the Forms page)
- Per-template specifics: what fields go where, how sign-offs are structured, what photos appear on which pages
- Whether the form has any per-site quirks (e.g. CS053 categories shifted between form versions; documented as a one-off)

If a UDF field's intent is ambiguous, **ask** — don't guess. The cost of guessing wrong is a wrongly-rendered PDF that makes it past validation.

---

## End

If your output follows this spec, the upload UI accepts the pair (plus optional QR), validates them, slots them into the next version slot, and registers them live. Neil sees the new template appear in the Admin → Templates table within seconds, and the next time someone clicks Download on a form whose `template_name` matches your `DALUX_TEMPLATE_NAME`, your PDF renders.
