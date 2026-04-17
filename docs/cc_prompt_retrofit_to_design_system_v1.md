# Claude Code prompt — retrofit existing templates to Design System v1.0

**Paste this into a fresh Claude Code session after saving the design system file to your repo.**

---

Hi Claude. The Dalux Forms project has just formalised a report design system — `docs/template_design_system_v1.md`. Every template rendered by this system must now conform to it. Your job is to bring the existing implementations into line and set up the infrastructure so all future templates inherit automatically.

## Context you need before starting

Read these files, in this order:

1. `docs/template_design_system_v1.md` — the canonical spec. Your output MUST conform to every rule in here.
2. `docs/DALUX_PROJECT_SCOPE_v3.3.md` — project state, conventions, tech-debt.
3. `docs/cs037_mock_v0.11.html` and `docs/cs037_mock_v0.11.pdf` — the reference implementation. Every component in the design system is exercised on this mock.
4. `docs/cs037_mock_v0.11_template.html` if present, or extract CSS from the rendered HTML — the structural source-of-truth.
5. The existing `backend/app/reports/cs053.py` and `cs053.html.j2` — in production, pre-design-system.
6. The existing `backend/app/reports/cs037.py` and `cs037.html.j2` — built from v0.6, needs updating to v0.11.

## Task

**Four deliverables in one session:**

### Deliverable 1 — Create the shared CSS partial

Create `backend/app/reports/templates/_spencer_design_system.css.j2` containing:

- All CSS custom properties (`:root { --spencer-blue: ...; ... }`) exactly as specified in the design system's Tokens section
- All component CSS classes (state pills, section headers, signature blocks, etc.) — extracted from `cs037_mock_v0.11.html`
- All auto-shrink tiers (`.id-value.len-md`, `.len-lg`, `.len-xl`) and their mono-variant equivalents
- The `@page` setup (A4, 10mm/15mm margins)
- The page-footer running element CSS (Calibri 7.5pt, 1.3 line-height, two-column flex layout)

Every downstream template should need only:
```jinja
<style>
  {% include '_spencer_design_system.css.j2' %}
  /* template-specific CSS only below this line */
</style>
```

Do not duplicate tokens or components in individual templates. Any class only one template uses (e.g. CS053's photo-appendix CSS) lives in that template. Anything shared lives in the partial.

### Deliverable 2 — Retrofit CS053

`cs053.html.j2` and `cs053.py` were built before the design system. They will have deviations. Bring CS053 into conformance:

**Audit against the design system and fix anything that doesn't match:**

- Font stack must be Calibri-led (`"Calibri", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif`) throughout. If CS053 is Helvetica, change it.
- Page margins: 10mm/10mm/10mm/15mm. If CS053 uses different margins, change them.
- Colours: use the design-system tokens only. If CS053 has any hardcoded colours that don't match (especially any dividers not set to `--divider` Spencer Blue or `--divider-soft` `#D8DCE6`), change them.
- Identifier grid column widths must be 20/60/20. Project no. must be cell (1,1) — if CS053 has Site or anything else in that position, reorder.
- Footer must be the new two-column structure with email above page counter on the right. If CS053 has the old three-line footer or no email, restructure.
- Auto-shrink size classes applied to `.id-value` cells.
- Sentence case throughout.
- State pills: ensure colours match design system (`--ok-green` / `--err-red` / `--na-grey`).
- Status chip: closed/open/expired logic matches design system.
- Photo appendix component stays (CS053-specific deviation — documented in design system §"Documented deviations").
- Findings & Actions table stays (same — CS053-specific).

**Builder changes needed:**
- `cs053.py` must resolve `modifiedBy_userId` → `DLX_2_users.email` for the footer email field. If it currently doesn't, add the query.
- Apply the `size_class()` filter to identifier grid values. Code is in the design system doc.
- Apply timezone-aware datetime display for any date/time fields (use `zoneinfo.ZoneInfo('Europe/London')`, label GMT/BST).

**Keep CS053's production reference forms working without regression:**
- `S430266406840305664` (Carrington CS053_23)
- `S432861154763606016` (Carrington CS053_24)
- `S405358071733291008` (NESY CS053_14)

After the retrofit, re-render each. Visual diff against current production rendering. Any functional regression (wrong data, missing content, broken links) is a blocker — UI changes are expected, functional changes are not.

### Deliverable 3 — Update in-progress CS037

The CS037 build was based on mock v0.6. It needs to catch up to v0.11:

**Changes between v0.6 and v0.11:**
- Font stack → Calibri-led (was Helvetica)
- Page margins → 10mm/10mm/10mm/15mm (was 15mm/15mm/15mm/22mm)
- Footer restructured → two-column layout, email above page counter on the right (was single-column)
- Footer includes modifier email (new field, pulled from `DLX_2_users.email` for `modifiedBy_userId`)
- Box edges changed to Spencer Blue `--divider` (was grey `#D8DCE6`)
- Sentence case throughout (was mixed Title Case)
- Auto-shrink size classes on identifier grid values
- Column widths on identifier grid: 20/60/20 with Project no. in cell (1,1)
- Title smaller (13pt, single line) and centred in header band
- Timezone label (GMT/BST) on validity block values

Rewrite `cs037.html.j2` to match v0.11 by extracting from `docs/cs037_mock_v0.11.html`. Use the shared CSS partial — don't duplicate tokens.

Update `cs037.py`:
- Ensure `size_class()` function is present and applied
- Ensure `zoneinfo` timezone conversion is present for all datetime fields
- Ensure modifier email lookup via `DLX_2_users` join
- Ensure signer name resolution via UDF `description` column (post-sync-fix)

**Test forms** (re-render after changes):
- `S427377143454894080` (CS037_8 Menai Bridge) — primary validation
- `S405283324253177856` (CS037_1 — old open permit, tests expired-open chip)
- `S432801637065558016` (CS037_3 — still-open permit, tests amber chip)
- `S401406462607230976` (CS037_1 — different project, tests site fallback)

### Deliverable 4 — Update scope doc and commit

Bump `DALUX_PROJECT_SCOPE_v3.3.md` to `v4.0.md`. The major-version bump reflects the design-system lock — it's a real architectural decision point, not a minor sync.

Include in v4.0:
- New section "Design system governance" pointing to `template_design_system_v1.md`
- Note that the older `template-design-playbook.md` is superseded; archive it (rename to `docs/_archive/template-design-playbook-v0.md`)
- Update the template list — CS053 and CS037 both "conformant with Design System v1.0"
- Tech-debt log updates:
  - Mark n8n repeating-group fix as RESOLVED
  - Mark `description` column addition as RESOLVED
  - Add: "Production hosts need Calibri installed for WeasyPrint rendering. On Linux, substitute with Carlito (metrics-compatible open-source alternative)."
- Update git history reference after this commit series

**Commits (suggest one series):**
1. `feat: Add shared Spencer design system CSS partial`
2. `refactor: Retrofit CS053 to Design System v1.0`
3. `refactor: Update CS037 to Design System v1.0`
4. `chore: Bump scope doc to v4.0; archive superseded playbook`

## Acceptance criteria

Every one of these must pass before closing the session:

- [ ] `_spencer_design_system.css.j2` exists and is included by both `cs053.html.j2` and `cs037.html.j2`
- [ ] No duplicate CSS tokens between the partial and the templates
- [ ] CS053 rendered PDF for `S430266406840305664` matches the design system visually (same fonts, colours, margins, footer structure)
- [ ] CS037 rendered PDF for `S427377143454894080` matches `cs037_mock_v0.11.pdf` visually
- [ ] All four CS037 test forms render without error
- [ ] All three CS053 validation forms render without error
- [ ] Both templates' footers show `{email} / Page {N} of {M}` right-stacked
- [ ] Both templates' identifier grids have Project no. in cell (1,1)
- [ ] Filename pattern matches design system on both templates
- [ ] `DALUX_PROJECT_SCOPE_v4.0.md` created; v3.3 archived
- [ ] `template-design-playbook.md` archived

## Guardrails

- **Do NOT introduce new colours, fonts, or components** outside the design system. If you think something needs a new token, raise in chat.
- **Do NOT break CS053 production rendering** — functional regression is a blocker.
- **Do NOT change backend infrastructure** (service.py registry, main.py dict, photo cache, download endpoint) unless a specific requirement above says so. The design system is about presentation; registration is orthogonal.
- **Do NOT redefine tokens locally** in template files. If the shared partial doesn't have what you need, add it to the partial.
- **Do NOT invent DB columns** — the `DLX_2_users.email` column exists (verified during the design session); every other column referenced is documented in the design system or scope doc.

## If something blocks you

Raise in chat with:
- What you were trying to do
- What you observed vs what the design system / scope doc says
- The exact file, line, error if applicable

Do not silently deviate from the design system. If the current code "needs" to deviate for some reason, flag it and we discuss — the whole point of this exercise is that deviations are visible, justified, and documented.
