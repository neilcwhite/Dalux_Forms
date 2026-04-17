# Spencer Dalux Report Design System — v1.0

**Status:** Locked  
**Derived from:** CS037 mock v0.11 (canonical reference — see `docs/cs037_mock_v0.11.pdf`)  
**Owned by:** Neil Pass (Senior Civil Engineer / QA Lead, The Spencer Group)

---

## What this document is for

Every report template rendered through the Dalux Forms system must conform to this design. The goal is OCD-level visual consistency — a permit-to-work, a weekly inspection, a plant certificate, a CAR/NCR, and any other report Spencer generates should be recognisable as members of the same document family at a glance.

This supersedes any design decisions embedded in individual templates. Where this system conflicts with existing code (CS053, in-progress CS037), the templates must be brought into line — not the other way around.

---

## Governance

**For Claude in chat** (design sessions):
- Every new template design session begins by re-reading this document
- Mock outputs must conform to the tokens and components below without exception
- Deviations proposed during a session must be explicitly flagged, justified in writing, and — if accepted — added to the "documented deviations" section of this doc before being built
- If a design decision has not been made here, the default is: do what CS037 did

**For Claude Code** (implementation):
- Every template implementation session begins by re-reading this document
- The shared CSS partial `_spencer_design_system.css.j2` is the single source of truth for tokens
- Templates must `{% include %}` this partial; they must NOT redefine tokens locally
- Template-specific CSS is only for content that is genuinely unique to that template (e.g. CS053's photo appendix)

**Change control:**
- This document is versioned (currently v1.0). Version bumps require re-audit of all in-production templates
- Any change proposed here must be applied to all existing templates in the same commit series — no "this rule applies to new templates only" carve-outs
- The `template-design-playbook.md` (the older, shorter doc) is now superseded — its useful content has been absorbed here; it can be archived

---

## Non-negotiable rules

These are the rules that take priority over any individual design preference. Break them and you break the family.

**1.** Every template uses a single font family throughout the document. No mono/sans islands. One font, one family feel.

**2.** Every template has the same page setup: A4, 10mm top/sides, 15mm bottom, same footer structure on every page.

**3.** Every template has the Spencer logo top-right and a template-specific QR code top-left, in the header band on page 1.

**4.** Every template shows Project no. in the top-left cell of its identifier grid. This is the CDE's primary indexing key. No template may omit it or move it.

**5.** Every template ends every page with the footer: left block with Dalux Field / Form No. / Issue No. / Revision date and SOS location, right block stacking the form-completer's email above the page counter.

**6.** Every template uses sentence case for all labels, headers, status text. Acronyms, proper nouns, and role titles (Permit Controller, Person in Charge) are preserved as title case.

**7.** Every template pulls Site Name and Project No. from the `DLX_2_projects`/`sheq_sites` join, never from UDFs. These are project metadata, not user-entered.

**8.** Every cross-collation join uses `COLLATE utf8mb4_unicode_ci` on both sides.

---

## Tokens

### Colours

Encoded as CSS custom properties. These are the only colours allowed in any template. If a template appears to need a colour not on this list, raise in chat — don't introduce one locally.

```css
:root {
  /* Brand */
  --spencer-blue:        #233E99;  /* Primary — section bands, box edges, title, accents */

  /* States */
  --ok-green:            #2E7D4F;  /* Positive / closed / Yes answers */
  --err-red:             #C0392B;  /* Negative / expired / No answers / failures */
  --na-grey:             #8A8A8A;  /* Not applicable / neutral / no-data */
  --amber:               #B26500;  /* Open-but-still-valid / data quality warnings */

  /* Text */
  --text:                #1A1A1A;  /* Primary text — all content */
  --text-muted:          #555;     /* Secondary text — labels, captions, footer */

  /* Surfaces */
  --bg-alt:              #FAFBFD;  /* Panel backgrounds — identifier grid cells, narrative labels */

  /* Dividers */
  --divider:             #233E99;  /* Strong divider — box edges (matches Spencer Blue) */
  --divider-soft:        #D8DCE6;  /* Soft divider — internal row lines, footer top-rule */
}
```

**Allowed use per colour** (strict):
- `--spencer-blue` — section header bands, identifier grid cell borders, outer section borders, title, permit validity block border, accent text in person-card headers, auto-shrink chip on caption
- `--ok-green` — Yes pill, Closed status chip
- `--err-red` — No pill, Expired status chip
- `--na-grey` — N/A pill
- `--amber` — Open-within-validity status chip, Data Quality banner
- `--text` — body text, value text in id-grid, signatures captions
- `--text-muted` — labels, caption subtext, footer text, provenance line
- `--bg-alt` — alternating row backgrounds, narrative label cells, id-grid cell backgrounds, person cards
- `--divider` — outer/structural borders on content blocks
- `--divider-soft` — internal row dividers inside tables, horizontal rules above footer and provenance

### Typography

**Font stack** (every template, everywhere):
```css
font-family: "Calibri", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
```

Calibri first (Spencer's corporate font). Segoe UI as the closest Windows fallback. Helvetica chain for macOS / non-Windows. Arial last as guaranteed universal fallback.

**Size scale:**

| Role | Size | Weight | Notes |
|---|---|---|---|
| Document title | 13pt | 700 | Spencer Blue, single line, `white-space: nowrap` |
| Section header | 9pt | 700 | White on Spencer Blue band, letter-spacing 0.7px |
| Section head sub-text | 7.5pt | 400 | rgba(255,255,255,0.80) on same band |
| Identifier grid label | 6.5pt | 400 | `--text-muted`, letter-spacing 0.4px |
| Identifier grid value | 10.5pt | 600 | `--text`, line-height 1.1 |
| Identifier grid value (mono variant) | 9.5pt | 600 | Same Calibri stack — "mono variant" is a size hint only, never a font-family change |
| Validity block value | 11pt | 700 | `--text`, all black, includes timezone label at same size |
| Validity block label | 7pt | 400 | `--text-muted`, letter-spacing 0.4px |
| State pill | 8pt | 700 | White on coloured bg, letter-spacing 0.6px |
| Status chip | 8.5pt | 700 | White on state-coloured bg, letter-spacing 0.5px |
| Body text | 9.5pt | 400 | `--text`, line-height 1.4 |
| Signature caption (name) | 8.5pt | 700 | `--text` |
| Signature caption (timestamp) | 7.5pt | 400 | `--text-muted` |
| Signature role label | 6.5pt | 400 | `--text-muted`, letter-spacing 0.4px |
| Narrative label cell | 7.5pt | 400 | `--text-muted`, letter-spacing 0.3px |
| Precaution table row | 9pt | 400 | `--text`, line-height 1.35 |
| Person card header | 7.5pt | 700 | `--spencer-blue`, letter-spacing 0.4px |
| Position label | 6.5pt | 400 | `--text-muted`, letter-spacing 0.4px |
| Position value | 10pt | 600 | `--text` |
| Provenance line | 7.5pt | italic 400 | `--text-muted`, centred |
| Footer text | 7.5pt | 400 | `--text-muted`, line-height 1.3 |
| Footer page counter | 7.5pt | 400 | `--text-muted` |

**Auto-shrink tiers** (applied by builder when text exceeds its cell width):

```css
.id-value.len-md { font-size: 9.5pt; line-height: 1.15; }
.id-value.len-lg { font-size: 8.5pt; line-height: 1.20; }
.id-value.len-xl { font-size: 7.5pt; line-height: 1.25; }
```

Builder function (Python):

```python
def size_class(text, mono=False):
    if not text: return ''
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

### Spacing

All spacing in pt, in four tiers:

| Tier | Value | Use |
|---|---|---|
| Tight | 2pt | Inside table cells, between label and value |
| Normal | 5-6pt | Standard padding inside section bodies, table rows |
| Loose | 8-10pt | Section body padding, between content blocks |
| Section gap | 12pt | Between sections on the same page |

### Border weights

| Weight | Use |
|---|---|
| 1px solid `--divider` | Identifier grid, section body, narrative table, person cards, validity block internal dividers |
| 1.5pt solid `--spencer-blue` | Validity block outer border (stronger visual weight — this is the legal core of a permit) |
| 1px solid `--divider-soft` | Internal row dividers in precaution tables, horizontal rules above footer, horizontal rule above provenance |
| 1px dashed #B5BCCB | Signature placeholder box (used only when attachment missing) |

### Page setup

```css
@page {
  size: A4;
  margin: 10mm 10mm 15mm 10mm;
}
```

All templates. No exceptions.

---

## Components

### 1. Document header band (page 1 only)

Three-cell layout at the top of page 1.

- **QR code cell** — 62×62px, left-aligned. Template-specific QR image via `_find_asset()` with prefix `{FORM_CODE}_` (e.g. `CS037_PERMIT_TO_UNDERTAKE_HOT_WORK_QR.png`)
- **Title cell** — centred horizontally. Text: `{FORM_CODE} — {Title in mixed case}` — e.g. `CS037 — Permit to Undertake Hot Work`. Spencer Blue, 13pt, weight 700, single line
- **Logo cell** — 40pt tall, right-aligned. Spencer Group logo (`Spencer Group logo.png`) with transparent background

### 2. Identifier grid

`table-layout: fixed` with three columns.

- **Column widths:** 20% / 60% / 20%. Middle column wider to accommodate long site names and WPP numbers.
- **Project no. must be in cell (1,1)** — top-left. This is the CDE anchor.
- **Two rows** of three cells each, typical content:

```
|  Project no. / SOS   |  Site (wide)             |  Form no. (Dalux)  |
|  Permit no. (or equiv)  WPP / Method statement no.  Status chip      |
```

- Each cell has a small label above the value. Label = 6.5pt muted letterspaced. Value = 10.5pt weight 600.
- Auto-shrink tiers applied to values when they would overflow.
- Cell borders use `--divider` (Spencer Blue). Internal dividers between cells use the same.
- Cell background `--bg-alt`.

### 3. Validity block (permit-only component)

Only on permit-type templates. Not used on inspections, records, CARs.

- **Outer border:** 1.5pt solid `--spencer-blue` (stronger than standard — reflects legal criticality)
- **Header band:** Spencer Blue bg, white text. Left: title uppercase "Permit validity — one shift only" (or equivalent per template). Right: timezone note "All times shown in GMT/BST (UTC±00:00)" in `rgba(255,255,255,0.80)`.
- **Body:** three cells — From / To / Duration. Values 11pt, black, include timezone label at same size immediately after the time.

Timezone handling: API datetimes arrive as UTC. Builder converts to Europe/London via `zoneinfo` and labels GMT or BST dynamically.

### 4. Section header + body

Used for every major section (Part A, Part B, etc.).

- **Header band:** Spencer Blue bg, white text, 9pt weight 700. Optional sub-text after main title in `rgba(255,255,255,0.80)`, 7.5pt weight 400, margin-left 8pt. Padding: 4pt 10pt.
- **Body:** 1px solid `--divider` on all sides except top (no top border — it connects to the header band). White background. Standard padding: 8pt 10pt. For tables that fill the body, set `.no-pad` class to remove padding.

Sections use `page-break-inside: avoid` — never split a section across pages.

### 5. Signature block

Used wherever a signature is captured.

- **Signature image area:** 220×75px. When attachment is present, render the PNG at `object-fit: contain; object-position: left center;` with a 1px solid `--divider-soft` bottom border. When absent, use dashed `#B5BCCB` placeholder with chevron pattern.
- **Caption below:** Name (8.5pt weight 700 `--text`) on first line. Optional timestamp on second line (7.5pt `--text-muted`).
- **Role label above:** 6.5pt `--text-muted` letterspaced, identifies which signature this is (e.g. "Signed by Permit Controller", "Signed — Completion").

**Signer name sourcing:** `DLX_2_form_udfs.description` of the signature anchor UDF (post-sync-fix). Fallback chain: form `createdBy` for initial signatures; `modifiedBy` for closing signatures; `(unknown)` as final fallback.

### 6. State pills

Used for Yes/No/N/A and similar tri-state answers.

- Display as inline rectangular chip. Padding 2pt 8pt, border-radius 2pt, min-width 52px, text-align center.
- Font: 8pt weight 700, white text, letter-spacing 0.6px.
- Sentence case ("Yes" / "No" / "N/A"), never uppercase.
- `.yes` background `--ok-green`, `.no` background `--err-red`, `.na` background `--na-grey`.
- `.blank` fallback (unanswered) — transparent bg, dashed `--na-grey` border, muted grey text. Use em-dash as content.

### 7. Status chip

Used in the identifier grid's Permit status cell (or equivalent).

- Inline rounded chip (border-radius 10pt), 8.5pt weight 700, white text.
- `.closed` → `--ok-green` bg, text "Closed"
- `.open` (within validity) → `--amber` bg, text "Open"
- `.expired` (status=open AND validity-to in past) → `--err-red` bg, text "Expired"

### 8. Data Quality banner

Optional component. Only rendered when real data-quality flags exist for the form.

- Amber 1px border (`--amber`), amber-pale bg (`#FFF3E0`), 7pt 10pt padding.
- Title "Data quality notes" uppercase, bold, amber, 8pt.
- Body: bulleted list of findings, 8.5pt, line-height 1.45.

Don't invent flags — only surface genuine issues (e.g. validity start before form creation, expired open permit, sync gap between attachment count and UDF instance count).

### 9. Provenance line

Appears once per document, at the bottom of the last content section before the footer.

- 1px `--divider-soft` top rule. 6pt padding-top. 12pt margin-top.
- Text centred, italic, 7.5pt, `--text-muted`.
- Content: `Generated from Dalux Field · Form ID {formId} · Form No. {number} · Status: {status} · Created {date} by {createdBy} · Modified {date} by {modifiedBy}`

### 10. Footer

**Appears on every page** via WeasyPrint running element.

- Top: 1px solid `--divider-soft` rule, 4pt padding-top.
- Font: Calibri stack, 7.5pt, `--text-muted`, line-height 1.3.
- **Two-column layout** — left block stacks two lines, right block stacks two lines, both align `flex-start`.

**Left block (2 lines):**
```
Dalux Field · Form No. {number} · Issue No. {issue} · Revision date {date}
SOS location: {path}
```

Note: "Dalux Field" is bolded (inline `<strong>`) — the only typographic emphasis in the footer.

**Right block (2 lines, right-aligned):**
```
{modifier email}
Page {N} of {M}
```

- Email source: `DLX_2_users.email` for `DLX_2_forms.modifiedBy_userId`. Fallback `(email not on file)`.
- Page counter via CSS `counter(page) " of " counter(pages)` in a `::before` pseudo-element.

---

## Asset naming

Assets live at `backend/app/reports/static/`.

- **Universal:** `Spencer Group logo.png` — used by every template
- **Per template:** `{FORM_CODE}_{DESCRIPTION}_QR.png` — e.g. `CS037_PERMIT_TO_UNDERTAKE_HOT_WORK_QR.png`, `CS053_WEEKLY_SAFETY_INSPECTION_QR.png`

The `_find_asset()` helper in `service.py` resolves by prefix, so filenames are human-readable for the SHEQ team but machine-lookup keyed on the form code.

---

## Filename pattern

Every rendered PDF must use this pattern:

```
{yyyy-mm-dd}_{FORM_CODE}_{SiteNameSanitised}.pdf
```

Where:
- **Date** = the form's contextually-meaningful date, in Europe/London local:
  - Permits: validity-From date
  - Inspections: inspection date
  - Records: session date
  - Fallback: form `created` date
- **FORM_CODE** = first token of `DLX_2_forms.number`, e.g. `CS037` from `CS037_8`
- **SiteNameSanitised** = `sheq_sites.site_name` (or `DLX_2_projects.projectName` fallback) with spaces and non-alphanumerics stripped. This is the same sheq-first rule as the on-page Site cell — filename and display must agree.

**Deliberately omitted:** the Dalux formId and the form-completer's email address. Both were tried earlier (email as an identifier tail, formId for uniqueness) and both made filenames ugly without helping the reader. If two forms of the same code are generated for the same site on the same day, the browser will suffix `(1)`, `(2)` on the client side. If shared-drive archival later requires guaranteed uniqueness, the dev team can append a hash to the filename at deployment time — but the human-facing filename must stay this short.

Examples:
- `2026-03-13_CS037_C2142MenaiBridgePhaseII.pdf`
- `2026-04-02_CS053_C2118CarringtonPRU.pdf`
- `2026-01-23_CS053_C2111NESYReplacementofSteelDockGate.pdf`

---

## Data access rules

**Never from UDFs** — these are project metadata, always pulled from joins:
- Site Name → `sheq_sites.site_name` (or `DLX_2_projects.projectName` fallback)
- Project Number / SOS → `sheq_sites.sos_number` (or `DLX_2_projects.number` fallback)
- Project ID → `DLX_2_forms.projectId`

**Always from UDFs** — these are user-entered per form:
- Dates of work / validity / inspection
- Narrative content (descriptions, equipment, notes)
- State answers (Yes/No/N/A reference values)
- Item-level signatures (via UDF anchor → attachment join)

**Always from form-level columns:**
- Status (`DLX_2_forms.status`)
- Form number (`DLX_2_forms.number`)
- Created/modified timestamps and userIds
- Template name (for matching against the handler registry)

**User details:**
- `DLX_2_users` for resolving `createdBy_userId` / `modifiedBy_userId` → display name, email
- Scope by `(userId, projectId)` composite PK
- Prefer `name` column; fallback to `firstName + " " + lastName`

---

## Sentence case rules

All labels, headings, section titles use sentence case. Preserve as title case:
- Proper nouns: Dalux, Spencer, Menai Bridge, person names, project names
- Acronyms: WPP, SOS, GMT, BST, UTC, CS037, N/A
- Abbreviations: No. (capital N)
- Role titles used formally: Permit Controller, Person in Charge (when referring to the named role)
- Structural document labels: Part A, Part B, etc. (capital A/B for the part identifier)

Everything else, first-letter-only capitalisation. No all-caps text (use CSS `text-transform` sparingly, and only where visually required — not used anywhere in v1.0).

---

## Documented deviations per template

When a template genuinely needs to deviate from this system, record the deviation here with justification.

### CS053 — Weekly Safety, Health, Environmental and Quality Inspection
- **Photo appendix (full-width, 2-per-page):** only CS053 needs this component because it's the only inspection template with per-item photo evidence. Not in the general component library.
- **Findings & Actions table:** CAR cross-reference table appears only on CS053 (no other template has linked CARs).

### CS037 — Permit to Undertake Hot Work
- **Validity block:** permit-only component — not used on other templates.
- **Multiple signature blocks per document (5):** permit has Permit Controller, Part C Supervisor, Part D Persons (1..N), Part E Completion. Other templates typically have 1-2.

### (Future templates add sections here as they're designed)

---

## Reference implementation

See `docs/cs037_mock_v0.11.pdf` and `docs/cs037_mock_v0.11.html` for the canonical rendering that exercises every component in this system.
