# Claude Code Task: CS053 Report — Findings Expansion Update

**Date:** 20 April 2026
**Scope:** Two files only — `backend/app/reports/cs053.py` and `backend/app/reports/templates/cs053.html.j2`
**Do not touch:** `service.py`, `main.py`, `_spencer_design_system.css.j2`, any other template

---

## Background

The CS053 Weekly Safety Inspection report currently shows safety issues (findings) as:
1. An inline tag on the checklist item row
2. A summary row in the Findings & Actions table

This is insufficient. The approved design mock shows each finding must be expanded into a full card containing: metadata (checklist item, subcategory, severity, raised by, assigned to, dates, work package, closed status), the finding description, a resolution strip (what was done to close it), and photo evidence thumbnails.

The approved HTML mock is at `cs053_mock.html` — use it as the visual reference. Do not deviate from its structure or styling.

---

## Change 1 — Remove from `cs053.html.j2`: Data Quality banner

Delete the entire DQ banner block from the template. It is a developer diagnostic, not a client-facing element.

Remove this block in full:

```html
{% if dq_warnings %}
<div class="dq-banner">
  <div class="dq-title">Data Quality Notes</div>
  <ul>{% for w in dq_warnings %}<li>{{ w }}</li>{% endfor %}</ul>
</div>
{% endif %}
```

Also remove the `.dq-banner` and `.dq-banner .dq-title` CSS rules from the `<style>` block.

Also remove `dq_warnings` from the return dict in `cs053.py` — it is no longer needed.

---

## Change 2 — Remove from `cs053.html.j2`: Owner initials chip column

Each item row currently has four columns: item-num | item-body | item-photo | item-owner | item-state.

Remove the `item-owner` column entirely from every item row. The inspector name is already shown in the header identifier grid — the per-row initials chip is redundant.

In the template, delete every instance of:
```html
<div class="item-owner">
  {% if item.state %}<span class="owner-chip">{{ inspector_initials }}</span>{% endif %}
</div>
```

Also remove from the CSS:
- `.item-owner { ... }` rule
- `.owner-chip { ... }` rule

Also remove `inspector_initials` from the return dict in `cs053.py` — it is no longer needed anywhere.

---

## Change 3 — Update `cs053.py`: Enrich findings data

The `findings` list currently contains:

```python
{
    "number": ..., "subject": ..., "item_ref": ...,
    "severity": ..., "assignee": ..., "closed_date": ...,
    "evidence": [...], "evidence_nos": [...]
}
```

Add the following fields to each finding dict:

| New field | Source | Notes |
|---|---|---|
| `subcategory` | `DLX_2_task_udfs` where `field_name = 'Safety subcategory'` | Use `value_reference_value` or `value_text` |
| `description` | `DLX_2_task_udfs` where `field_name = 'Description'` — if absent, use first `DLX_2_task_changes.description` where `action = 'assign'` | The written description of what was found |
| `raised_by` | `resolve_user(task.createdBy_userId)["fullName"]` — pull `createdBy_userId` from `DLX_2_tasks` | Who raised the finding |
| `deadline` | `DLX_2_tasks.deadline` formatted as UK date via `_uk_date()` | |
| `work_package` | `DLX_2_workpackages.name` joined via `DLX_2_tasks.workpackageId` | LEFT JOIN — may be NULL |
| `resolution_message` | `DLX_2_task_changes.description` where `action = 'ready'` ORDER BY timestamp DESC LIMIT 1 | The close-out message entered when marking ready |
| `resolution_by` | `resolve_user(that task_change.modifiedByUserId)["fullName"]` | Who closed it out |
| `resolution_date` | `_uk_date(that task_change.timestamp)` | |

**Pulling `raised_by`:** The existing tasks query only returns `taskId`, `number`, `subject`, `created`. Extend it to also return `createdBy_userId` from `DLX_2_tasks`.

**Pulling `work_package`:** Add a LEFT JOIN to `DLX_2_workpackages` on `workpackageId`. Use `COLLATE utf8mb4_unicode_ci` on both sides per the project collation rule.

**Resolution query — add this per finding:**
```python
res = db.execute(text(
    "SELECT tc.description, tc.modifiedByUserId, tc.timestamp "
    "FROM DLX_2_task_changes tc "
    "WHERE tc.taskId = :tid AND tc.action = 'ready' "
    "ORDER BY tc.timestamp DESC LIMIT 1"
), {"tid": t["taskId"]}).mappings().first()

f["resolution_message"] = res["description"] if res else ""
f["resolution_by"] = resolve_user(res["modifiedByUserId"])["fullName"] if res else ""
f["resolution_date"] = _uk_date(str(res["timestamp"])[:10]) if res else ""
```

**Severity badge class:** Add a helper to map severity integer to CSS class:

```python
def _sev_class(severity: str) -> str:
    """Map severity string to CSS badge class."""
    try:
        s = int(severity or 0)
    except (ValueError, TypeError):
        return ""
    if s >= 5:
        return "sev5"
    if s >= 4:
        return "sev4"
    if s >= 3:
        return "sev3"
    return ""
```

Add `"sev_class": _sev_class(tudf_map.get("Severity", ""))` to each finding dict.

---

## Change 4 — Update `cs053.html.j2`: Expanded findings cards section

### 4a — Remove the existing findings table

Delete the current `<section class="actions-section">` block entirely, including the `<table class="findings-table">` and everything inside it. It is being replaced by the two-layer structure below.

Also remove the associated CSS rules: `.actions-section`, `.findings-table`, `.td-no`, `.td-none`, `.find-hdr`, `.find-item`, `.find-meta`.

### 4b — Add new two-layer findings section

Insert the following **after** the signoff block and before the provenance line.

**New CSS to add inside the `<style>` block:**

```css
/* ---- Findings section ---- */
.findings-section-head {
  background: var(--spencer-blue);
  color: #fff;
  padding: 8pt 12pt;
  font-size: 11pt;
  font-weight: 700;
  margin-top: 16pt;
  margin-bottom: 12pt;
}

/* Summary table */
.findings-summary-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-bottom: 16pt; }
.findings-summary-table th {
  background: var(--bg-alt);
  border: 1px solid var(--divider);
  padding: 5pt 8pt;
  font-weight: 700; text-align: left;
  color: var(--spencer-blue); font-size: 8pt;
}
.findings-summary-table td { border: 1px solid var(--divider); padding: 5pt 8pt; vertical-align: top; }
.fs-hdr { font-weight: 700; }
.fs-item { color: var(--text-muted); font-size: 8pt; margin-top: 2pt; }
.fs-meta { font-size: 7.5pt; color: var(--text-muted); margin-top: 1pt; }
.fs-none { text-align: center; color: var(--ok-green); font-weight: 600; padding: 12pt 0; }
.fs-closed { color: var(--ok-green); font-weight: 600; }
.fs-open { color: #B7770D; font-weight: 600; }

/* Expanded finding cards */
.finding-card { border: 1px solid var(--divider); margin-bottom: 14pt; }
.finding-card-header {
  background: var(--spencer-blue); color: #fff;
  padding: 8pt 12pt;
  display: table; width: 100%; table-layout: fixed;
}
.finding-card-header > div { display: table-cell; vertical-align: middle; }
.fc-num { font-size: 14pt; font-weight: 700; width: 60pt; }
.fc-subject { font-size: 10pt; font-weight: 600; line-height: 1.3; }
.fc-sev {
  width: 70pt; text-align: right;
  font-size: 8pt; font-weight: 700;
}
.fc-sev span {
  display: inline-block; padding: 3pt 10pt; border-radius: 3px;
  background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4);
}
.fc-sev span.sev5 { background: var(--err-red); border-color: var(--err-red); }
.fc-sev span.sev4 { background: #E07B00; border-color: #E07B00; }
.fc-sev span.sev3 { background: #B7770D; border-color: #B7770D; }

.finding-meta-grid { display: table; width: 100%; table-layout: fixed; border-collapse: collapse; }
.fmg-row { display: table-row; }
.fmg-cell {
  display: table-cell; width: 50%;
  padding: 5pt 10pt;
  border-right: 1px solid var(--divider);
  border-bottom: 1px solid var(--divider);
  font-size: 8.5pt;
}
.fmg-cell:nth-child(even) { border-right: none; }
.fmg-label { color: var(--text-muted); font-weight: 600; font-size: 7.5pt; text-transform: uppercase; margin-bottom: 1pt; }
.fmg-value { font-weight: 600; }
.fmg-closed { color: var(--ok-green); font-weight: 600; }
.fmg-open { color: #B7770D; font-weight: 600; }

.finding-description {
  padding: 8pt 10pt;
  font-size: 9pt; line-height: 1.5;
  border-bottom: 1px solid var(--divider);
  background: var(--bg-alt);
}
.fd-label { font-weight: 700; font-size: 7.5pt; text-transform: uppercase; color: var(--text-muted); margin-bottom: 3pt; }

.resolution-strip {
  padding: 5pt 8pt;
  background: #EAF4EE;
  border-left: 3px solid var(--ok-green);
  font-size: 8pt;
  border-bottom: 1px solid var(--divider);
}
.res-label { font-weight: 700; color: var(--ok-green); margin-right: 4pt; }

.finding-photos { padding: 8pt 10pt; }
.fp-label { font-weight: 700; font-size: 7.5pt; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6pt; }
.fp-row { display: table; width: 100%; border-collapse: separate; border-spacing: 8pt 0; }
.fp-cell {
  display: table-cell;
  border: 1px solid var(--divider);
  width: 155pt;
  vertical-align: top;
}
.fpc-img {
  width: 100%; height: 105pt;
  background: var(--bg-alt);
  border-bottom: 1px solid var(--divider);
  position: relative; overflow: hidden;
}
.fpc-img img { width: 100%; height: 100%; object-fit: cover; }
.fpc-missing { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 8pt; color: var(--text-muted); }
.fpc-badge {
  position: absolute; top: 4pt; left: 4pt;
  background: var(--spencer-blue); color: #fff;
  font-size: 7pt; font-weight: 700; font-family: monospace;
  padding: 2pt 5pt; border-radius: 2px;
}
.fpc-src {
  position: absolute; top: 4pt; right: 4pt;
  background: #FDECEA; color: var(--err-red);
  border: 1px solid var(--err-red);
  font-size: 6pt; font-weight: 700; padding: 1pt 4pt; border-radius: 2px;
}
.fpc-caption { padding: 3pt 5pt; font-size: 7.5pt; color: var(--text-muted); }
```

**New Jinja template block to insert:**

```jinja
{% if findings %}
<div class="findings-section-head">
  Findings &amp; Actions &mdash; {{ findings|length }} issue{% if findings|length != 1 %}s{% endif %} raised
</div>

{# --- Summary table --- #}
<table class="findings-summary-table">
  <thead>
    <tr>
      <th style="width:22pt">No.</th>
      <th>Finding</th>
      <th>Action taken</th>
      <th>Who by</th>
      <th>Closed</th>
      <th>Close call</th>
    </tr>
  </thead>
  <tbody>
    {% for f in findings %}
    <tr>
      <td style="text-align:center;font-weight:700">{{ loop.index }}</td>
      <td>
        <div class="fs-hdr">{{ f.number }} &mdash; {{ f.subject }}{% if f.evidence_nos %} (Evidence: {{ f.evidence_nos|join(', ') }}){% endif %}</div>
        <div class="fs-item">Item: {{ f.item_ref }}</div>
        <div class="fs-meta">Severity: {{ f.severity }}{% if f.subcategory %} &middot; {{ f.subcategory }}{% endif %}</div>
      </td>
      <td>{{ f.resolution_message or '(see Dalux task record)' }}</td>
      <td>{{ f.assignee }}</td>
      <td>{% if f.closed_date %}<span class="fs-closed">&#10003; {{ f.closed_date }}</span>{% else %}<span class="fs-open">Open</span>{% endif %}</td>
      <td>&mdash;</td>
    </tr>
    {% endfor %}
  </tbody>
</table>

{# --- Expanded finding cards --- #}
{% for f in findings %}
<div class="finding-card">
  <div class="finding-card-header">
    <div class="fc-num">{{ f.number }}</div>
    <div class="fc-subject">{{ f.subject }}</div>
    <div class="fc-sev"><span class="{{ f.sev_class }}">Severity {{ f.severity }}</span></div>
  </div>

  <div class="finding-meta-grid">
    <div class="fmg-row">
      <div class="fmg-cell"><div class="fmg-label">Checklist item</div><div class="fmg-value">{{ f.item_ref or '&mdash;' }}</div></div>
      <div class="fmg-cell"><div class="fmg-label">Subcategory</div><div class="fmg-value">{{ f.subcategory or '&mdash;' }}</div></div>
    </div>
    <div class="fmg-row">
      <div class="fmg-cell"><div class="fmg-label">Raised by</div><div class="fmg-value">{{ f.raised_by or '&mdash;' }}</div></div>
      <div class="fmg-cell"><div class="fmg-label">Assigned to</div><div class="fmg-value">{{ f.assignee or '&mdash;' }}</div></div>
    </div>
    <div class="fmg-row">
      <div class="fmg-cell"><div class="fmg-label">Date raised</div><div class="fmg-value">{{ f.date_raised or '&mdash;' }}</div></div>
      <div class="fmg-cell"><div class="fmg-label">Deadline</div><div class="fmg-value">{{ f.deadline or '&mdash;' }}</div></div>
    </div>
    <div class="fmg-row">
      <div class="fmg-cell"><div class="fmg-label">Work package</div><div class="fmg-value">{{ f.work_package or '&mdash;' }}</div></div>
      <div class="fmg-cell">
        <div class="fmg-label">Status</div>
        <div class="fmg-value">
          {% if f.closed_date %}
            <span class="fmg-closed">&#10003; Approved / Closed &mdash; {{ f.closed_date }}</span>
          {% else %}
            <span class="fmg-open">Open</span>
          {% endif %}
        </div>
      </div>
    </div>
  </div>

  {% if f.description %}
  <div class="finding-description">
    <div class="fd-label">Description</div>
    {{ f.description }}
  </div>
  {% endif %}

  {% if f.resolution_message %}
  <div class="resolution-strip">
    <span class="res-label">Resolution{% if f.resolution_date %} ({{ f.resolution_date }}{% if f.resolution_by %} &mdash; {{ f.resolution_by }}{% endif %}){% endif %}:</span>
    {{ f.resolution_message }}
  </div>
  {% endif %}

  {% if f.evidence %}
  <div class="finding-photos">
    <div class="fp-label">Evidence Photos ({{ f.evidence|length }})</div>
    <div class="fp-row">
      {% for e in f.evidence %}
      <div class="fp-cell">
        <div class="fpc-img">
          {% if e.local_src %}
            <img src="{{ e.local_src }}" alt="Photo #{{ e.photo_no }}">
          {% else %}
            <div class="fpc-missing">Photo #{{ e.photo_no }}<br>not downloaded</div>
          {% endif %}
          <div class="fpc-badge">#{{ e.photo_no }}</div>
          <div class="fpc-src">EVIDENCE</div>
        </div>
        <div class="fpc-caption">{{ f.number }} &middot; Photo {{ loop.index }} of {{ f.evidence|length }}</div>
      </div>
      {% endfor %}
    </div>
  </div>
  {% endif %}

</div>
{% endfor %}

{% else %}
<div style="text-align:center;color:var(--ok-green);font-weight:600;padding:14pt 0;">
  No findings raised during this inspection.
</div>
{% endif %}
```

---

## Change 5 — Update `cs053.py`: Add `date_raised` to findings

The finding card displays `date_raised`. Add this to the finding dict when building it from the tasks query. Pull `DATE(t["created"])` and format with `_uk_date()`:

```python
f["date_raised"] = _uk_date(str(t["created"])[:10]) if t["created"] else ""
```

The tasks query already returns `created` — no additional DB query needed.

---

## Validation

Test against these three forms after making changes:

| Form ID | Form No. | Expected |
|---|---|---|
| `S430266406840305664` | Carrington CS053_23 | 1 finding (SI46). Expanded card renders with description + photo. |
| `S432861154763606016` | Carrington CS053_24 | 2 findings (SI47, SI48). Both cards render. |
| `S405358071733291008` | NESY CS053_14 | 0 findings — "No findings raised" message shows. No card section. |

For each form verify:
1. No Python exceptions in terminal
2. DQ banner is absent
3. Owner initials column is absent from all item rows
4. Findings section header shows correct count
5. Summary table renders all findings
6. Each expanded card shows: metadata grid, description (if present), resolution strip (if closed), evidence photos (if any)
7. Photo `#N` numbers in expanded cards match the inline evidence references on the checklist item rows

---

## Files to modify
- `backend/app/reports/cs053.py`
- `backend/app/reports/templates/cs053.html.j2`

## Files to NOT touch
- `backend/app/reports/service.py`
- `backend/app/reports/templates/_spencer_design_system.css.j2`
- `backend/app/main.py`
- Any other file

## Reference
The approved visual mock is saved as `cs053_mock.html` in the project root. If in doubt about layout or styling, refer to that file.
