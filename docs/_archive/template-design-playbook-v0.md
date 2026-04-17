# Report Template Design Playbook

**Purpose:** Capture reusable design conventions across Dalux report templates so every new template doesn't re-debate the same decisions.

**Scope:** Applies to Spencer-branded client-ready PDF reports generated from Dalux forms data. First template was CS053; everything below is either directly reused or explicitly deviated from.

---

## Template classification

Not all forms are the same shape. Templates fall into families:

### Family A — Checklist inspections (e.g. CS053)
- Site-wide audit against a predefined list of items
- Each item has a state (Green / Red / N/A / blank)
- Grouped into categories (14 for CS053)
- Can have linked CARs for failed items
- Photos attached to specific items
- Summary statistics at top

**Design language:**
- Inline rows per item with state pill, photo thumb, owner initials, findings tag
- Category headers with count chips (Green/Red/N/A, dimmed when zero)
- Data Quality banner when category state disagrees with item states
- Findings & Actions summary table
- Full-width 2-per-page photo appendix

### Family B — Permits (e.g. CS037)
- Authorisation for a specific time-bound activity
- Issuer / holder / authoriser identified
- Hazard controls and mitigations
- Explicit validity window
- Sign-on and sign-off stages
- Typically a single work activity, much shorter than Family A

**Expected design language** (to be validated with CS037):
- Permit reference number prominent
- Issuer/holder/authoriser block as a dedicated section
- Validity window (from → to) as a dedicated element
- Hazard controls as a smaller checklist within the permit
- Sign-on / sign-off as first-class elements (not just a footer signature)
- Probably fewer photos than an inspection — photos inline rather than appendix

### Family C — Records (e.g. CS033 toolbox talk)
- List of attendees with signatures
- Topic covered
- Presenter identified
- Date / duration

### Family D — CARs / NCRs / Findings
- Single issue, raised-then-resolved
- Severity, category, location
- Before/after photo evidence
- Remediation timeline
- Closed-out sign-off

### Family E — Registrations
- Inspection plan / test plan / ITP entries
- Run through a list of planned activities with completion status per entry

---

## Universal conventions (apply to ALL templates)

### Brand & typography
- **Font:** Helvetica Neue / Helvetica / Arial (fallback chain)
- **Spencer Blue:** `#233E99` — used for headers, accents, chips
- **Spencer Blue Pale:** `#EEF1FA` — used for secondary elements, hover states, inline evidence highlight
- **OK Green:** `#2E7D4F` — positive states
- **Err Red:** `#C0392B` — negative states, findings
- **N/A Grey:** `#8A8A8A` — not-applicable states
- **Divider Grey:** `#D8DCE6` — table borders, separators
- **Text primary:** `#1A1A1A`
- **Text muted:** `#555`

### Page layout (A4)
- Margin: 15mm top/sides, 22mm bottom (room for footer)
- `@page` bottom-left: Dalux Field, Form No., Issue No., Revision Date, SOS Location
- `@page` bottom-right: "Page X of Y" — reserve 80pt width so double-digit pages don't wrap
- Border-top separator on footer for visual break

### Document header (page 1)
- QR code (left, 70×70px) — `_find_asset()` resolves by prefix (`CS037_*` etc.)
- Title (centre) — form code dash form description in uppercase
- Spencer logo (right, 48px high)

### Key identifiers always present
- Site Name — **from `DLX_2_projects` / `sheq_sites` join, NOT UDFs**
- Project No. / SOS number — same source
- Form No. — from `DLX_2_forms.number`
- Status — from `DLX_2_forms.status`
- Date of form completion — from appropriate UDF or `DLX_2_forms.created`

### Summary statistics strip (where applicable)
- Cell count 4-6 (adjust per template needs)
- Label uppercase 7.5pt, value 18pt bold
- Colour values according to state (green for Green count, red for Red count, grey for N/A)
- Use `#FAFBFD` cell background with `#D8DCE6` border

### Owner identification
- Initials chip: monospace, 7.5pt, `#EDEFF4` bg, `#3F4B66` text, 10pt radius
- Shown against inspector/issuer/author as applicable
- **Current limitation:** form-level attribution only (documented in `audit_limitations.md`)

### Photos
- Inline photo size: **150×105px** with `#N` badge in top-left corner
- Badge: Spencer Blue bg, white text, monospace, 7pt, 2px radius
- Photo numbering: **sequential across the document**, inspection photos first then CAR evidence photos
- Appendix cells: **full width, 2 per A4 page**, 100mm image height
- Cell header: "Photo #N" badge + item reference + "INSPECTION" or "CAR EVIDENCE" tag
- Cell border: 1px `#D8DCE6`
- Inline-to-appendix matching: `#N` badge matches between both locations so reader can cross-reference

### Provenance line
- Always include: "Generated from Dalux Field · Form ID: `{formId}` · Form No. `{number}` · Status: `{status}`"
- 7.5pt italic, centred, muted grey

### Footer contents
- Dalux Field (line 1)
- Form No. / Issue No. / Revision Date (line 2)
- SOS Location hint (line 3)
- Page counter (right-aligned)
- Border-top 1px `#D8DCE6`

### Filename pattern
- `yyyy-mm-dd_FormType_SiteName_FormID.pdf`
- Date from form creation
- FormType = first segment of form.number (e.g. `CS037` from `CS037_12`)
- SiteName = `sheq_sites.site_name` if mapped, else `DLX_2_projects.projectName` — special characters stripped

---

## Checklist-specific conventions (Family A — from CS053)

These apply when the form is a checklist inspection. Skip if designing a permit / CAR / etc.

### Category headers
- Blue strip, 5px vertical padding
- Category number (large, centred, 36px wide) with right border
- Category title (bold, 10.5pt, letter-spaced 0.2px)
- Count chips right-aligned: `[N GREEN] [N RED] [N N/A] [N BLANK]`
- Chips have coloured background matching state; zero counts dim to 0.35 opacity
- Blank chip shown only if blanks exist (dashed border, white-on-blue semi-transparent)

### Item rows
- Alternating row background: white / `#FAFBFD`
- Columns: num | body | photo | owner | state
- Item number: 9pt bold, Spencer Blue
- Item title: 9pt, 1.35 line-height
- Findings: inline red-bordered block showing CAR ref, subject, severity, assignee, closed/open, evidence refs

### State pills (in rows)
- 8pt bold uppercase, 50px min-width, 3px 10px padding
- Green: solid OK Green bg, white text
- Red: solid Err Red bg, white text
- N/A: solid N/A Grey bg, white text
- Blank: transparent bg, dashed N/A Grey border, muted grey text, dash character

### Data Quality banner
- Red-bordered, Err Red Pale bg, 8.5pt
- "Data Quality Notes" title uppercase, bold, red
- Bulleted list of inconsistencies
- Example: "Category 'X' header recorded as Green but contains Red item(s)."

### Findings & Actions table (appendix)
- Rendered after all categories
- Columns: No. / Finding (multi-line with CAR header, item ref, severity, evidence refs) / Action / Who By / Closed Date / Close Call
- "No findings raised during this inspection." centred, green, bold if zero findings

---

## Deviations to consider per template family

### For Permits (Family B — CS037 etc.)
- **Skip category count chips** — probably no categories
- **Prominent "PERMIT VALID FROM / TO" block** with dates + times
- **Sign-on / sign-off matrix** — rows for each required sign-off party, with dates and signature blocks
- **Hazard checklist** — similar to Family A items but smaller, more compact, probably no photos per item
- **No appendix** unless photos genuinely warrant one
- **Permit reference number** shown prominently on page 1

### For CARs (Family D)
- **Single finding as the whole report** — no categories
- **Before/after photo comparison** side-by-side
- **Remediation narrative** — what was done, by whom, when
- **Acceptance sign-off** — explicit close-out block

### For Records (Family C)
- **Attendee table** is the main content
- **Signatures** are photos or digital captures
- **Minimal photo evidence** — maybe one photo of the whiteboard / materials

### For Registrations (Family E)
- **Tabular** rather than card-like
- **Checklist of ITP entries** with completion markers
- **Probably no photos** — this is an audit trail document

---

## Data access rules

### Never look up in UDFs (use project metadata instead)
- Site Name → `sheq_sites.site_name` or fallback `DLX_2_projects.projectName`
- Project Number / SOS → `sheq_sites.sos_number` or fallback `DLX_2_projects.number`
- Project ID → `DLX_2_forms.projectId`

### Always look up in UDFs (user-entered per form)
- Inspection date / permit validity dates
- Inspector / issuer / holder names (usually relations to users)
- Subcontractors / companies involved (relations to companies)
- Specific narrative fields (permit conditions, findings, etc.)
- Item states (Green/Red/N/A for checklists)

### Form-level metadata (from `DLX_2_forms` columns)
- Status — `status` column
- Created / modified timestamps
- Created by / modified by user ID — form-level attribution, NOT per-item
- Form number — `number` column

### Rule for every new field in a new template
- Sanity-check: is this field user-entered or platform-populated?
- If user-entered → UDF lookup with fallback
- If platform-populated → direct column / join
- **Don't guess** — verify against a real form's data first

---

## Asset filename conventions

Assets live in `backend/app/reports/static/`.

Naming pattern: **Form code prefix as underscore-separated token.**

- `Spencer Group logo.png` — universal, prefix `Spencer Group logo` or `spencer_logo`
- `CS053_WEEKLY SAFETY... [QrCode].png` — QR for CS053, prefix `CS053_`
- `CS037_PERMIT TO UNDERTAKE HOTWORK [QrCode].png` — QR for CS037, prefix `CS037_`

The `_find_asset(folder, prefixes)` helper resolves by prefix. Descriptive filenames for humans; prefix matching for code.

---

## When to deviate

The conventions above are defaults, not handcuffs. Deviate when:

- **The form family demands it** — Permits genuinely need a different structure than inspections
- **Client requirements override** — e.g. a specific client wants their logo added
- **Legal / audit requirements demand** — e.g. NCRs might need explicit contract clause references
- **Data structure doesn't match** — e.g. some forms might have item-level notes that don't fit "findings" pattern

But **flag deviations in the scope doc** so we know which templates break the pattern and why. This keeps the playbook honest.
