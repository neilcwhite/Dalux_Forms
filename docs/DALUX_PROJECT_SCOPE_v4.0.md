# DALUX PROJECT — SCOPE & STATUS

**Last updated:** 17 Apr 2026
**Document version:** v4.0 (Design System v1.0 locked; CS053 + CS037 retrofitted and conformant)

---

## Purpose & Context

Neil is a Senior Civil Engineer / QA Lead at The Spencer Group (Tier 1 construction). Building a multi-phase data pipeline and reporting platform that:
1. Extracts data from Dalux Build REST API → on-premise MariaDB
2. Generates client-ready PDF reports via Python
3. Publishes via a web interface for staff downloads

Workflow orchestration via self-hosted n8n. Apache Superset dashboards are a lower-priority future phase.

---

## Design system governance

**The canonical visual and structural spec is `docs/template_design_system_v1.md`.**

Every report template rendered by this system must conform to it. The partial `backend/app/reports/templates/_spencer_design_system.css.j2` is the code-level source of truth for tokens and shared components — templates include it and only define template-specific CSS below.

**Rules:**
- No template may redefine tokens locally. If a new colour/component is needed, raise in chat, add to the design system, and apply retroactively to all existing templates in the same commit series.
- Every new design session (chat) and every template-wiring session (Claude Code) begins by re-reading the design system doc.
- The older `template-design-playbook.md` is superseded and has been archived to `docs/_archive/template-design-playbook-v0.md`.
- Legacy scope docs (`v3.3`, `v3.4`) are archived to `docs/_archive/` for history.

---

## Tool split going forward

**Claude chat (claude.ai Project) — design and architecture work:**
- Report template design and iteration (CS053 done, CS037 done, next suggested: CAR/NCR)
- Architectural decisions and tradeoff discussions
- Scope doc updates and cross-session continuity

**GitHub Copilot / Claude Code (VS Code) — code and debugging work:**
- Wiring templates into the backend
- Bug fixes and diagnostic work
- Running commands and tests
- Git operations

**Synchronisation rules:**
- Every Claude Code session ends with scope doc update if structural change
- Every chat session starts with current scope doc + design system doc pasted in
- Before designing a new template in chat, the latest `cs053.py` / `cs037.py` and `service.py` are pasted for ground truth
- Per-template handoff docs (e.g. `docs/CS037_claude_code_handoff.md`) capture spec+plan for each wiring session

---

## Key People & Systems

- **Three active Dalux projects referenced:**
  - Carrington `S338264162301902849`
  - Silverstone `7230333205`
  - Clacton Depot `8517908386`
  - ~50 total Dalux projects, 16 mapped in `sheq_sites`
- **MariaDB host:** `DBHUB.cspencerltd.co.uk` (accessed via VPN from dev laptop)
- **Schema prefix:** `DLX_2_*`
- **SHEQ master site list:** `sheq_sites` (186 rows), joined to Dalux via `sheq_sites.dalux_id = DLX_2_projects.projectId`
- **Dalux Build API v2.2**, auth: single `X-API-KEY` header
- **n8n:** web UI only, no terminal access

---

## Phase Status

### ✅ PHASE 1: API Discovery (Complete)

### ✅ PHASE 2: n8n Sync Workflows (Complete + patched for repeating groups)
Tasks v3 (hourly), Plans & Reference (nightly), Forms v3 (nightly).

Patched on 17 Apr 2026 to support CS037:
- `DLX_2_form_udfs` gained a `description VARCHAR(500)` column — holds signer names captured in Dalux
- PK extended to `(formId, userDefinedFieldId, field_set, value_index)` so repeating-group instances don't collide on upsert
- Forms sync workflow now extracts `udf.description` into the new column

### ✅ PHASE 3: Design System v1.0 (Locked 17 Apr 2026)

Canonical spec: `docs/template_design_system_v1.md`. Derived from `docs/cs037_mock_v0.11.html`/`.pdf`. See "Design system governance" section above.

### ✅ PHASE 4: Web Platform — Local Prototype (Sessions 1-5 Complete)

**Stack:**
- **Backend:** Python 3.14 + FastAPI + SQLAlchemy + PyMySQL (MariaDB read-only) + SQLite (local app state)
- **Frontend:** React 18 + TypeScript + Vite + TanStack Query + react-router-dom + Tailwind
- **Auth:** None (single-user local); deferred to dev team
- **Photos / signatures:** Fetch-on-demand via Dalux API key in `.env`, cached to `backend/photo_cache/`
- **Reports:** Cached to `backend/reports_cache/` by `(form_id, form.modified)`
- **PDF generation:** WeasyPrint + MSYS2 GTK3 runtime on PATH (local dev); GTK3 apt packages in Docker image
- **Timezones:** `zoneinfo` + `tzdata` (required on Windows for IANA zone lookup)
- **Fonts:** Calibri (Windows has it via Office; Linux hosts need Carlito — see tech debt #11)

**Project structure:**
```
C:\GitHub\Dalux_Forms\
├── backend/
│   ├── app/
│   │   ├── config.py       ← .env loader
│   │   ├── database.py     ← MariaDB + SQLite engines
│   │   ├── models.py       ← Download model (SQLite)
│   │   ├── main.py         ← FastAPI endpoints
│   │   └── reports/
│   │       ├── service.py  ← orchestrator + photo cache + per-handler filename dispatch
│   │       ├── cs053.py    ← CS053 builder (conformant with DS v1.0)
│   │       ├── cs037.py    ← CS037 builder (conformant with DS v1.0)
│   │       ├── templates/_spencer_design_system.css.j2  ← shared tokens + components
│   │       ├── templates/cs053.html.j2
│   │       ├── templates/cs037.html.j2
│   │       └── static/     ← logos + QR codes (CS053_*, CS037_* prefix naming)
│   ├── data/app.db         ← SQLite (gitignored)
│   ├── photo_cache/        ← (gitignored)
│   ├── reports_cache/      ← (gitignored)
│   ├── requirements.txt    ← (tracked)
│   └── venv/               ← (gitignored)
├── frontend/
│   └── (unchanged)
├── docs/
│   ├── DALUX_PROJECT_SCOPE_v4.0.md (current)
│   ├── template_design_system_v1.md (canonical design spec)
│   ├── CS037_claude_code_handoff.md
│   ├── cs037_mock_v0.6.{html,pdf}   ← initial CS037 design (superseded)
│   ├── cs037_mock_v0.11.{html,pdf}  ← canonical DS v1.0 reference
│   ├── audit_limitations.md
│   └── _archive/
│       ├── DALUX_PROJECT_SCOPE_v3.2.md
│       ├── DALUX_PROJECT_SCOPE_v3.3.md
│       ├── DALUX_PROJECT_SCOPE_v3.4.md
│       └── template-design-playbook-v0.md
├── docker-compose.yml, DOCKER_SETUP.md, Dockerfiles (packaging for colleagues)
└── .gitignore
```

**Endpoints (all live on :8000):**
- `GET /` — health
- `GET /api/health/db` — row counts
- `GET /api/sites` — joined site list with fallback
- `GET /api/sites/form-summary` — per-project undownloaded + stale counts
- `GET /api/form-types` — distinct templates with `has_custom_report` + `display_name`
- `GET /api/forms?site_id[]&form_type&date_from&date_to&status&not_downloaded_only&limit`
- `GET /api/forms/{form_id}/download` — generates/serves cached PDF, logs to `app_downloads`
- `POST /api/forms/bulk-download` — ZIP of selected PDFs

**UI features (all live on :5173):**
- URL-driven filter state
- Multi-select site chip filter with severity tiers (green/amber/red by stale-undownloaded count)
- Form type dropdown with custom-report flag
- Date range + status + "not downloaded" filters
- Results table with metadata + download count + modified-since-download indicator
- Per-row "Generating…" spinner during PDF build + bulk ZIP spinner
- Checkbox multi-select + bulk ZIP download
- Open-status warning before download (audit safeguard)

**Validated end-to-end with real data (post-DS-v1.0 retrofit):**

CS053:
- Carrington CS053_23 (`S430266406840305664`) — 10-page PDF, 1 CAR, photo appendix, design system conformant
- Carrington CS053_24 (`S432861154763606016`) — 2 CARs
- NESY CS053_14 (`S405358071733291008`) — zero findings, alternate site mapping

CS037:
- Menai Bridge CS037_8 (`S427377143454894080`) — primary reference form (matches `cs037_mock_v0.11.pdf`)
- Kessock CS037_1 (`S405283324253177856`) — expired-open red chip
- Kessock CS037_3 (`S432801637065558016`) — post-DST BST label
- Sandbox CS037_1 (`S401406462607230976`) — different project site mapping

**Deferred / follow-on work (still needed before production):**
- Bulk download UX polish — CSV export of filtered list alongside ZIP
- Admin page: unmapped sites handler, download audit log viewer
- Additional template candidates: CAR/NCR, CS033 toolbox talk, CS172 excavation checklist

### 🟡 PHASE 5: Hand-off to Dev Team (Not Started)
Local prototype working end-to-end. Dev team owns: hosting, Entra SSO, photo pre-fetch implementation, production deployment. Docker Compose packaging now in place for colleague distribution (see `DOCKER_SETUP.md`). Linux-host font dependency flagged (tech debt #11).

### 🟡 PHASE 6: Additional Report Templates (post-retrofit)

**Completed + DS-v1.0-conformant:**
- **CS053** — Weekly Safety, Health, Environmental and Quality Inspection. Checklist style, 14 categories, UDF-driven states, linked CAR findings, photo appendix. Locked 16 Apr 2026, retrofitted 17 Apr 2026.
- **CS037** — Permit to Undertake Hot Work. Permit style, 3-page A4, validity block with GMT/BST handling, Part B 13 precautions, Part D repeating group with per-instance signatures. Locked 17 Apr 2026, DS-v1.0-conformant.

**Future target templates (priority TBC):**
- CAR/NCR reports (Family D per playbook)
- Inspection plan / test plan registration reports (Family E)
- Task action registers
- CS172 Excavation Inspection Checklist (Family A)
- CS033 Record of Training / Toolbox Talk (Family C)

Each new template = chat session for design (against DS v1.0), Claude Code session to wire in.

### 🔴 PHASE 7: Apache Superset Dashboards (Lower Priority)

---

## Technical Debt Log

1. **Collation mismatch** — `DLX_2_*.projectId`/`userId` uses `utf8mb4_general_ci`, `sheq_sites.dalux_id` uses `utf8mb4_unicode_ci`. Every join requires `COLLATE utf8mb4_unicode_ci` on both sides. Fix: `ALTER TABLE` to unify. Dev team owns.

2. **Per-item ownership not captured** — Dalux stores field-level change history server-side but n8n sync doesn't pull it. Only form-level `createdBy_userId` / `modifiedBy_userId` available. Report shows inspector/submitter initials. Documented in `docs/audit_limitations.md` for dev team.

3. **Task→form linkage inferred** — `DLX_2_tasks` has no parent-form FK. Join: `(projectId, usage='SafetyIssue', DATE(created) == DATE(form.created))`. Risk: same-day double inspections cross-attribute. Not yet observed.

4. **Photo / signature token expiry** — Dalux URL tokens may expire between sync and download. Production will pre-fetch via n8n. Also applies to CS037 signature PNGs.

5. **`sheq_sites.dalux_id` mapping incomplete** — 34 of 50 Dalux projects unmapped. Needs owner. Report falls back to `DLX_2_projects.projectName` but Spencer would prefer SOS number + site_name to always appear.

6. **Existing v3 report generator uses task-derived state** — retire when new layout fully in production.

7. **Reserved word `usage` in queries** — cs053.py fixed but pattern could recur.

8. **Every Spencer project uses the same master form templates** (confirmed for CS053 and CS037) — UDF field names are consistent across projects. Rule for future templates: always check whether a field is user-entered (UDF) or platform-populated (project metadata).

9. **[RESOLVED 17 Apr 2026]** Forms-sync schema gaps — `DLX_2_form_udfs` was discarding `udf.description` (signer names) and its PK didn't include `field_set`, so repeating-group upserts collided. Fixed by adding the `description VARCHAR(500)` column and extending the PK to include `field_set`. Verification queries live in `docs/CS037_claude_code_handoff.md`.

10. **[RESOLVED 17 Apr 2026]** CS037 site-source deviation — CS037 was initially rendering with `projectName`-first for display and filename. Retrofit to Design System v1.0 moved it to `sheq_sites.site_name`-first per design system §Data access rules, matching CS053 and eliminating the per-template carve-out.

11. **Calibri font dependency on production hosts** — Templates lead with Calibri (`"Calibri", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif`) to match Spencer's company font. WeasyPrint renders with whatever is installed on the host; if Calibri is missing the stack falls through, changing kerning and line-break behaviour. Windows hosts with Microsoft Office already have Calibri. Linux hosts (likely containerised) will not — install `fonts-crosextra-carlito` (open-source, metrics-compatible with Calibri) or copy the Calibri `.ttf` files into the image. The current `backend/Dockerfile` does neither; add a `RUN apt-get install -y fonts-crosextra-carlito` line before rolling out container-hosted PDF generation.

12. **CS037 Part D attachment lookup** — UDF `field_set` is form-id-prefixed but `form_attachments.udf_set` stores only the suffix. Builder strips the `{formId}_` prefix before lookup. Documented here so a future refactor doesn't silently break Part D signatures.

---

## Reference Forms

### CS053 validation set (post-retrofit)

- **Carrington CS053_23** `S430266406840305664` (2 Apr 2026, closed) — 140 UDFs, 1 linked CAR. Primary design-system validation (inspection context + categories + photo appendix + findings table all render correctly).
- **Carrington CS053_24** `S432861154763606016` (9 Apr 2026) — 142 UDFs, 2 CARs. 18 MB PDF due to photo count.
- **NESY CS053_14** `S405358071733291008` (23 Jan 2026, closed) — 120 UDFs, zero findings; validates alternate site mapping.

### CS037 validation set (post-retrofit)

- **Menai Bridge CS037_8** `S427377143454894080` (25 Mar 2026, closed) — primary reference form. 28 UDFs, 5 signatures, 2 Part D persons. Renders to 3-page A4 matching `cs037_mock_v0.11.pdf`.
- **Kessock CS037_1** `S405283324253177856` (23 Jan 2026, open) — validates "Expired" red status chip and "Signature not synced" placeholder + auto-shrink on long site name.
- **Kessock CS037_3** `S432801637065558016` (8 Apr 2026, open) — validates BST label for post-DST permits.
- **Sandbox CS037_1** `S401406462607230976` (12 Jan 2026, closed) — validates alternate-project site mapping where sheq_sites has no entry.

---

## Tools & Stack

- **Dalux Build REST API** v2.2
- **Self-hosted n8n** (UI only, no terminal)
- **On-premise MariaDB** (DBHUB.cspencerltd.co.uk via VPN)
- **Python 3.14** + VS Code + GitHub Copilot / Claude Code
- **Python packages:** fastapi, uvicorn, sqlalchemy, pymysql, python-dotenv, jinja2, weasyprint, requests, tzdata
- **Node.js 24 LTS** for React frontend
- **MSYS2 GTK3** for WeasyPrint system libraries (local dev) / GTK3 apt packages in Docker image
- **Calibri** (Windows via Office) / Carlito (Linux) for WeasyPrint font rendering
- **Git** version control at `C:\GitHub\Dalux_Forms`

---

## Restart checklist

Opening a fresh terminal:
```powershell
cd C:\GitHub\Dalux_Forms\backend
.\venv\Scripts\Activate.ps1
$env:PATH = "C:\GitHub\Dalux_Forms\backend\venv\Scripts;" + $env:PATH + ";C:\msys64\mingw64\bin"
uvicorn app.main:app --reload --port 8000
```

Second terminal for frontend:
```powershell
cd C:\GitHub\Dalux_Forms\frontend
npm.cmd run dev
```

Browser: `http://localhost:5173`

For colleague distribution: `docker-compose up -d` → `http://localhost` (see `DOCKER_SETUP.md`).

---

## Key Principles

- **Contract compliance paramount** — legal dimension takes priority
- Outputs must be factual, defensible, audit-ready
- Accuracy > speed
- `userDefinedFields` stored as JSON columns given variable structure
- "NCR" doesn't exist as Dalux task type; CAR is the functional equivalent
- Render-only transformations don't mutate source data
- Secrets never committed (`.env` always gitignored)
- Local prototype first, dev team productionises
- **All new SQL joins across `DLX_2_*` and `sheq_sites` tables: always add `COLLATE utf8mb4_unicode_ci` on both sides**
- **Every new report template conforms to `docs/template_design_system_v1.md`** — via the shared `_spencer_design_system.css.j2` partial. No local token redefinition.
- **Match UDFs by `field_name`, not `field_key`** — names are stable once forms close; keys change across template issues
- **Before designing a new template:** sanity-check for each field whether it's user-entered (UDF) or platform-populated (project metadata)
- **For repeating-group UDFs:** attachments join by `(udf_key, udf_set)` where `udf_set` is the un-prefixed suffix of the UDF's `field_set`

---

## Git history (abridged)

- `38883fe` — FastAPI backend scaffold
- `7b62d00` — SQLite download tracking
- `972298d` — React frontend scaffold
- `5d583bb` — Forms page with URL filters
- `bf44329` — CS053 initial implementation
- `f0d993b` — CS037 template + playbook added
- `4610ad4` — CS037 wiring (v0.6 implementation)
- `fa724a5` — Download spinner + CS037 email filename + Calibri font stack
- *(next)* — Design System v1.0 retrofit: shared CSS partial + CS053/CS037 brought into conformance + scope doc v4.0

---

## Immediate next actions

1. **Chat:** Design next template against DS v1.0 — Neil's call (CAR/NCR suggested; CS172 also on the list)
2. **Claude Code:** Wire in that next template using the shared partial; confirm DS conformance on render
3. **Phase 5:** Dev team handover — working prototype + Docker distribution + DS-v1.0 documentation
4. **Production:** add `fonts-crosextra-carlito` to `backend/Dockerfile` before rolling out to Linux hosts (tech debt #11)
