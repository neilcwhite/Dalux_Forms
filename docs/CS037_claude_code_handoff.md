# CS037 Handoff — Template wiring for Claude Code

**For Claude Code:** This is the complete spec for implementing the CS037 Permit to Undertake Hot Work report template in the Dalux Forms backend. All design decisions are locked. This session is about implementation, not design.

---

## Executive summary

Extend the Dalux Forms backend to render PDFs for forms with Dalux `template_name = "Permit to undertake hot work"`. The design is complete and validated against real API data. Your job is to write the Python builder + Jinja template, register them in the existing infrastructure, and verify end-to-end rendering.

Do NOT re-design the layout. If you spot what looks like a design issue, raise it in chat before changing anything.

---

## Context you need before starting

1. **Read `docs/DALUX_PROJECT_SCOPE_v3.3.md`** — current system state, conventions, tech-debt items. Non-negotiable reading before you touch any code.
2. **Read `docs/template-design-playbook.md`** — Spencer design language, asset naming, filename patterns, data-access rules.
3. **Read `docs/cs037_mock_v0.6.html`** — the approved design. You will convert this directly to a Jinja template. The structure, CSS, content text, and visual hierarchy are locked.
4. **View `docs/cs037_mock_v0.6.pdf`** — the rendered version of the above, so you know what "done" looks like.
5. **Look at the existing `backend/app/reports/cs053.py` and `cs053.html.j2`** — your new files mirror this structure. Reuse patterns wherever possible.

---

## What's already been done (don't repeat)

### n8n sync workflow — UPDATED
The Forms sync workflow was patched during the design session:
- `DLX_2_form_udfs` gained a `description VARCHAR(500)` column — holds signer names captured in Dalux
- The table's primary key now includes `field_set` — `(formId, userDefinedFieldId, field_set, value_index)` — so repeating-group instances don't collide on upsert
- The workflow now extracts `udf.description` and writes it into the new column

Verification queries (run these first to confirm the sync is live and clean):

```sql
-- Should return 28
SELECT COUNT(*) FROM DLX_2_form_udfs WHERE formId = 'S427377143454894080';

-- Should return 5 rows with signer names populated
SELECT field_name, description, field_set
FROM DLX_2_form_udfs
WHERE formId = 'S427377143454894080' AND description IS NOT NULL;

-- Should show description column exists
SHOW COLUMNS FROM DLX_2_form_udfs;
```

If any of these don't return the expected result, STOP and raise in chat — the sync may not have run yet. Do NOT proceed with an out-of-date DB.

### Design mock
Already rendered, validated with real Menai Bridge data (formId `S427377143454894080`), and approved. Located at `docs/cs037_mock_v0.6.html` / `.pdf`.

---

## Files you will CREATE

### 1. `backend/app/reports/static/CS037_PERMIT_TO_UNDERTAKE_HOT_WORK_QR.png`
The QR asset. Neil has already supplied this file — it should be saved at this path. Naming follows the `CS037_*` prefix convention from the playbook so `_find_asset()` resolves it.

If the file isn't present at the path above when you start, ask Neil — he has it locally.

### 2. `backend/app/reports/cs037.py`
The builder module. Mirrors the structure of `cs053.py`. Exports whatever the existing `TEMPLATE_HANDLERS` registry expects (see section below on registration).

### 3. `backend/app/reports/templates/cs037.html.j2`
The Jinja2 template. Converted from `docs/cs037_mock_v0.6.html` with:
- Hard-coded values replaced with Jinja expressions
- `__QR_DATA_URI__` / `__LOGO_DATA_URI__` tokens replaced with file references via the same asset-lookup helper CS053 uses
- Signatures rendered from cached PNG paths, not placeholder SVG stroke glyphs

---

## Files you will MODIFY

### `backend/app/reports/service.py`
Add CS037 to the `TEMPLATE_HANDLERS` registry (or whatever it's called). Key is the Dalux `template_name` string **exactly as it appears in the DB**: `"Permit to undertake hot work"` (lowercase 'u' in 'undertake', lowercase 'w' in 'work' — verify against `DLX_2_forms.template_name` for the sample form, don't guess).

### `backend/app/main.py`
Add CS037 to the `TEMPLATES_WITH_CUSTOM_REPORT` dict:
```python
"Permit to undertake hot work": {
    "code": "CS037",
    "display": "CS037 — Permit to undertake hot work",
}
```

Confirm exact dict shape by looking at the existing CS053 entry.

---

## Data contract — what the builder reads from the DB

Every column name below has been verified against the actual DB schema during the design session.

### Form header (from `DLX_2_forms`)
```
formId, number, status, created, createdBy_userId, modified, modifiedBy_userId, projectId, template_name
```

### Site / project info (join `DLX_2_projects` + `sheq_sites`)
Same pattern as CS053 — `sheq_sites` if mapped, fallback to `DLX_2_projects`. **Every join across `DLX_2_*` and `sheq_sites` requires `COLLATE utf8mb4_unicode_ci` on both sides.** Tech debt #1 in scope doc.

Provide: `site_name`, `project_num` (SOS number or project number).

### User attribution (from `DLX_2_users`)
Resolve `createdBy_userId` and `modifiedBy_userId` to display names. `DLX_2_users` has columns `name, email, firstName, lastName, company, role`. Prefer `name`; fall back to `firstName + " " + lastName` if `name` is NULL.

Scope the lookup by `(userId, projectId)` — composite PK. `DLX_2_users` has `projectId` in its PK because the same user can appear on multiple projects.

### UDFs (from `DLX_2_form_udfs`)
```
formId, projectId, userDefinedFieldId, field_key, field_set, field_name, description,
value_text, value_date, value_datetime, value_number,
value_reference_key, value_reference_value,
value_relation_userId, value_relation_companyId
```

**All lookups in this template should match by `field_name`**, not `field_key`. The field names are frozen once forms are closed (per the Dalux API spec). Every Spencer project uses the same master CS037 template, so names are consistent. Keys change across template issues; names don't.

### Attachments (from `DLX_2_form_attachments`)
```
attachmentId, formId, projectId, udf_key, udf_set, fileName, fileDownloadUrl, created, modified, deleted
```

Join to UDFs via `(udf_key = field_key AND udf_set = field_set)`. Filter `deleted = 0`.

---

## Specific UDFs the builder needs

Match each by exact `field_name`. Nothing invented — these are the actual names recorded in the DB for this template.

### Header block (singletons)
| field_name | Value source | Used for |
|---|---|---|
| `WPP / MS No:` | `value_text` | Permit header |
| `Permit No:` | `value_text` | Permit header |
| `From:` | `value_datetime` | Validity window start (UTC) |
| `To:` | `value_datetime` | Validity window end (UTC) |

### Signature anchors (singletons — one per Part)
Each anchor UDF has empty `values[]` but **carries the signer's name in `description`** and links to one row in `form_attachments`.

| field_name | Part | Signer from |
|---|---|---|
| `Signed by Permit Controller:` | Authorisation (before Part A) | `description` |
| `Signed (Person in Charge of Operations / Supervisor)` | Part C | `description` |
| `Signed` | Part E | `description` |

### Part A (singletons)
| field_name | Value source |
|---|---|
| `Description of Work and Location:` | `value_text` |
| `Details of Equipment to be used:` | `value_text` |

### Part B — 13 precaution items (singletons, render in this exact order)
Each has `value_reference_key` (0/1/2) mapping to `value_reference_value` ("Yes"/"No"/"N/A").

Display list (copy field_name verbatim, preserve spacing/punctuation):
1. `Sprinklers and/ or fire hose in service:`
2. `Portable fire extinguishers at site of work (State Type):`
3. `Cutting/ burning/ welding equipment in good repair:`
4. `Operator(s) competent and certification checked:`
5. `Area clear of combustible/ flammable materials (within 50ft) including dust, debris etc:`
6. `Combustible surfaces made safe by screening, covering or other means:`
7. `Flammable substances or liquids that cannot be moved, made safe:`
8. `Services in area identified and protected (gas, water, electricity, telephone, cabling etc.):`
9. `All wall and floor openings covered:`
10. `If work site is elevated, are precautions in place to prevent sparks etc. falling below or has access to the area below been restricted to make safe:`
11. `Screening or protect fellow workers or members of the public from sparks and/or exposure to welding arc etc:`
12. `Other processes that may be affected? State precautions taken:`
13. `Is work taking place in confined space? State precautions taken:`

Display text in the template is slightly reformatted (sentence case, cleaner spacing) — see `cs037_mock_v0.6.html` for the exact display strings. Keep the DB lookup keys verbatim as above.

If a precaution UDF isn't present on a form (rare — deleted mid-form, sync gap, etc.), render the row with a `blank` state pill (class already exists in the mock CSS).

### Part D — repeating group
Three UDFs per instance, all sharing the same `field_set` value:

| field_name pattern | Extract |
|---|---|
| `N Permit controls accepted and understood by:` (where N = 1, 2, 3…) | instance header label — the N becomes the display "Person N" number |
| `Signature:` | signer name from `description`; attachment via `(udf_key, udf_set)` |
| `Position:` | `value_text` |

Group all UDFs by `field_set`. Within each set, extract the header (to get N), the signature (for name + attachment lookup), and the position. Render one card per set in ascending N order.

Edge cases:
- If no Part D instances exist → render section with `<p>No persons acknowledged — Part D not completed.</p>`
- If an instance is missing Position → render position as em-dash `—`
- If an instance's signature attachment is missing → render signature box empty with a small note `Signature not synced`

---

## Business logic the builder implements

### 1. Auto-shrink size class
Straight port from the mock. Add as a Jinja filter.

```python
def size_class(text, mono=False):
    """Return CSS class to apply for auto-shrink; '' if no shrink needed.
    Thresholds calibrated for A4, 60/20/20 id-grid, 10.5pt base font."""
    if not text:
        return ''
    n = len(str(text))
    if mono:
        if n > 28: return 'len-xl'
        if n > 20: return 'len-lg'
        if n > 14: return 'len-md'
    else:
        if n > 55: return 'len-xl'
        if n > 40: return 'len-lg'
        if n > 28: return 'len-md'
    return ''
```

Template usage:
```jinja
<div class="id-value {{ site_name | size_class }}">{{ site_name }}</div>
<div class="id-value mono {{ project_num | size_class(mono=True) }}">{{ project_num }}</div>
```

### 2. Timezone conversion
All API datetimes arrive as UTC. Display as Europe/London local time with a `GMT` or `BST` label.

```python
from zoneinfo import ZoneInfo
from datetime import datetime

def to_london(utc_dt: datetime) -> tuple[datetime, str]:
    """Convert a UTC datetime to Europe/London; return (local_dt, 'GMT'|'BST')."""
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=ZoneInfo('UTC'))
    london = utc_dt.astimezone(ZoneInfo('Europe/London'))
    return london, london.tzname()
```

Apply to `From:` and `To:` values before rendering. The validity header's "All times shown in GMT/BST (UTC+00:00)" note uses the same conversion.

### 3. Status chip
Three states:
- `closed` → green "Closed" chip — form is complete
- `open` AND `now > To` → red "Expired" chip — stale open permit (should have been closed)
- `open` AND `now <= To` (or `To` in future) → amber "Open" chip — permit is still valid

Compute "now" as UTC. Use the `To:` UDF's `value_datetime` for the comparison.

### 4. Duration display
Diff `To:` minus `From:`. Render as `Xh Ym` (e.g. `7h 57m`). If `To:` < `From:` or either is missing, render `—`.

### 5. Filename pattern
Per playbook but with validity-From date, not form-created date:

```
{yyyy-mm-dd}_CS037_{SiteNameSanitised}_{formId}.pdf
```

Where:
- Date is the **permit validity From** date (Europe/London local), formatted `yyyy-mm-dd`. If the From UDF is missing, fall back to form `created` date.
- `SiteNameSanitised` — strip spaces and non-alphanumeric characters. `Menai Bridge` → `MenaiBridge`. `C2111-NESY Replacement of Steel Dock Gate` → `C2111NESYReplacementofSteelDockGate`.
- `formId` — the full `S...` Dalux identifier.

Example: `2026-03-13_CS037_MenaiBridge_S427377143454894080.pdf`

### 6. Permit Controller name
Source: `Signed by Permit Controller:` UDF's `description` column.
Fallback chain if empty: `DLX_2_users.name` for `DLX_2_forms.createdBy_userId` → fallback `firstName + ' ' + lastName` → fallback `(unknown)`.

Same chain applies to Part C and Part E captions using their respective UDFs' `description` fields.

### 7. Permit Controller Authorisation body text
Static text — copy verbatim from the mock. It's a description of what the Permit Controller has checked before signing.

### 8. Signature images
1. Query the attachment for each signature anchor UDF via `(udf_key, udf_set)`.
2. Pass the attachment's `fileDownloadUrl` to the existing photo cache helper (reuse whatever CS053 uses — `_cache_photo()` or similar).
3. Render as `<img src="file://{cached_path}" class="sig-img-real">`.

Add a new CSS class `.sig-img-real` that holds the image at 220×75px with contain-fit, replacing the placeholder `.sig-img` stroke pattern:

```css
.sig-img-real {
  width: 220px;
  height: 75px;
  object-fit: contain;
  object-position: left center;
  border-bottom: 1px solid var(--divider-soft);
}
```

The placeholder `.sig-img` class from the mock should stay in the CSS as a fallback for when the attachment is missing or unreachable.

---

## Step-by-step work plan

### Step 1 — Verify DB is in expected state
Run the three verification queries above. Proceed only if all pass.

### Step 2 — Confirm assets exist
- `backend/app/reports/static/Spencer Group logo.png` — from CS053 era, should already exist
- `backend/app/reports/static/CS037_PERMIT_TO_UNDERTAKE_HOT_WORK_QR.png` — Neil supplies. Save here if not present.

### Step 3 — Write the builder skeleton
`backend/app/reports/cs037.py`. Mirror `cs053.py`'s module structure. Export the same interface (whatever `service.py`'s registry calls). Include:
- SQL queries for form, site, users, UDFs, attachments
- UDF field-name-keyed dict of values
- Part D grouping by `field_set`
- All business-logic functions above
- `render_html()` entry point that calls the Jinja template with a populated context dict

### Step 4 — Convert the mock HTML to Jinja
Load `docs/cs037_mock_v0.6.html`. Strip the embedded `__QR_DATA_URI__` and `__LOGO_DATA_URI__` references; replace with file-path references via the existing asset helper. Replace all hard-coded values with Jinja expressions.

### Step 5 — Register
Add to `TEMPLATE_HANDLERS` in `service.py`. Add to `TEMPLATES_WITH_CUSTOM_REPORT` in `main.py`.

### Step 6 — Test: primary target
Render for formId `S427377143454894080`. Expected output:
- 3 pages
- Matches `cs037_mock_v0.6.pdf` visually (allowing for real signatures instead of placeholders)
- Site: Menai Bridge · Project: C2142 · Form: CS037_8 · Permit: 008 · WPP: MST-PM0025 · Status: Closed
- Validity: 13 Mar 2026 08:03 GMT → 13 Mar 2026 16:00 GMT · 7h 57m
- Part D renders TWO persons (Charlie Cook / Charlie cook)
- Filename: `2026-03-13_CS037_MenaiBridge_S427377143454894080.pdf`

### Step 7 — Test: spread
Render three more CS037 forms to catch edge cases. Pick from each project:
- `S405283324253177856` (CS037_1, open, 23 Jan 2026) — tests the "expired open" red chip
- `S432801637065558016` (CS037_3, open, 8 Apr 2026) — tests a still-open permit
- `S401406462607230976` (CS037_1 on S313997131771805696, closed, 12 Jan 2026) — tests a different project's site mapping

### Step 8 — Update scope doc
Bump `DALUX_PROJECT_SCOPE_v3.3.md` to `v3.4.md`:
- CS037 status: locked, in production
- Tech debt log: mark "repeating-group PK collision" and "description column" as RESOLVED
- Add CS037 to Reference Forms section with validation form IDs
- Update git history section after the commit lands

### Step 9 — Commit
One commit for the CS037 files + registry updates. Message suggestion: `feat: Add CS037 Permit to Undertake Hot Work report generation`

---

## Acceptance criteria

All must pass before closing the session:

- [ ] Three verification SQL queries return expected results (28 rows, 5 named signatures, description column present)
- [ ] `cs037_mock_v0.6.pdf` and the live-rendered PDF for `S427377143454894080` match visually, section for section
- [ ] Filename follows the pattern `yyyy-mm-dd_CS037_{SiteNameSanitised}_{formId}.pdf`
- [ ] GMT/BST labels are computed dynamically — verify by rendering a post-DST-changeover form (anything after 29 Mar 2026, e.g. `S432801637065558016`)
- [ ] Status chip renders correctly across closed, open-in-validity, and expired-open forms
- [ ] Auto-shrink size classes apply correctly — no site name or WPP number wraps to a second line in any real form
- [ ] Existing CS053 reports still render unchanged (regression check)
- [ ] Download count still increments, audit log still logged (existing backend plumbing)

---

## Guardrails

### Do NOT invent column names
Every field and column referenced above has been verified. If you find yourself guessing at a column name you haven't seen in the scope doc, stop and ask.

### Do NOT match UDFs by field_key
Match by `field_name` in this template. Keys might change across template issues; names are stable once forms close.

### Do NOT skip the COLLATE clauses
Every join across `DLX_2_*` and `sheq_sites` needs `COLLATE utf8mb4_unicode_ci` on both sides. Tech debt #1. Fix in scope doc; don't introduce new collation bugs.

### Do NOT remove the placeholder sig-img CSS
Keep it as a fallback for forms where the signature attachment is missing. Don't replace — augment.

### Do NOT duplicate the photo cache implementation
Reuse whatever CS053 already has. If it's not suitably generic, refactor rather than copy-paste.

### Do NOT change the mock's design choices
Colours, fonts, layout, section order, copy text — all locked. If you think something should be different, raise it in chat before changing.

### Do NOT render with fake / synthesised data
The test target is real: formId `S427377143454894080` at Menai Bridge. Use actual DB data. If the render looks wrong, the DB or the builder is wrong — not the data.

---

## Reference data for cross-checking

These values come from the live API response for `S427377143454894080`. Use to validate the builder is extracting correctly.

```
formId:             S427377143454894080
projectId:          S407171799218915329
number:             CS037_8
template_name:      Permit to undertake hot work
status:             closed
created (UTC):      2026-03-25 08:04:11
createdBy_userId:   1857997_Nr8RzDl13XWP2gYv   → Charlie Cook
modified (UTC):     2026-04-02 07:11:23
modifiedBy_userId:  1857650_dLOGSonOJswwuimC   → Ryan Jackson

WPP / MS No:        MST-PM0025
Permit No:          008
From:               2026-03-13 08:03:00 UTC → 13 Mar 2026 · 08:03 GMT (local)
To:                 2026-03-13 16:00:00 UTC → 13 Mar 2026 · 16:00 GMT (local)
Duration:           7h 57m

Description:        Cutting and grinding of parapet bolts mainspan
Equipment:          4 inch grinder

Part B precaution answers (in display order):
  1. N/A   2. Yes   3. N/A   4. Yes   5. Yes
  6. N/A   7. N/A   8. N/A   9. N/A  10. N/A
 11. N/A  12. N/A  13. No

Signatures (5 total):
  Permit Controller:  Charlie Cook
  Part C Supervisor:  Ryan Jackson
  Part D Person 1:    Charlie Cook  (Engineer)
  Part D Person 2:    Charlie cook  (Engineer) — lowercase c verbatim
  Part E Completion:  Ryan Jackson

Expected filename:   2026-03-13_CS037_MenaiBridge_S427377143454894080.pdf
Expected page count: 3 (A4)
```

---

## If you get stuck

Raise in chat with:
- What you were trying to do
- What you observed vs what you expected
- The exact SQL / Python / error message

Do not fabricate data, invent column names, or "guess" at DB shape when stuck. The design session ran 15+ exchanges to eliminate assumptions; don't reintroduce them here.
