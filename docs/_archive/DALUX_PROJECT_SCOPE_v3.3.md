# DALUX PROJECT — SCOPE & STATUS

**Last updated:** 17 Apr 2026
**Document version:** v3.3 (CS053 validated end-to-end on real data; CS037 design starting)

---

## Purpose & Context

Neil is a Senior Civil Engineer / QA Lead at The Spencer Group (Tier 1 construction). Building a multi-phase data pipeline and reporting platform that:
1. Extracts data from Dalux Build REST API → on-premise MariaDB
2. Generates client-ready PDF reports via Python
3. Publishes via a web interface for staff downloads

Workflow orchestration via self-hosted n8n. Apache Superset dashboards are a lower-priority future phase.

---

## Tool split going forward

Project now uses two tools in parallel:

**Claude chat (claude.ai Project) — design and architecture work:**
- Report template design and iteration (CS053 done, CS037 next)
- Architectural decisions and tradeoff discussions
- Scope doc updates and cross-session continuity
- Stakeholder-facing deliverables (handover docs, design approvals)

**GitHub Copilot / Claude Code (VS Code) — code and debugging work:**
- Wiring templates into the backend
- Bug fixes and diagnostic work
- Refactoring
- Running commands and tests
- Git operations

**Synchronisation rules:**
- Every Claude Code session ends with scope doc update if structural change
- Every chat session starts with current scope doc pasted in
- Before designing a new template in chat, the latest `cs053.py` and `service.py` are pasted for ground truth
- `docs/template-design-playbook.md` captures reusable design conventions across templates
- `docs/claude-code-handoff.md` captures wiring conventions both tools must respect

---

## Key People & Systems

- **Three active Dalux projects referenced:**
  - Carrington `S338264162301902849`
  - Silverstone `7230333205`
  - Clacton Depot `8517908386`
  - Many more exist — 50 total Dalux projects, 16 mapped in `sheq_sites`
- **MariaDB host:** `DBHUB.cspencerltd.co.uk` (accessed via VPN from dev laptop)
- **Schema prefix:** `DLX_2_*`
- **SHEQ master site list:** `sheq_sites` (186 rows), joined to Dalux via `sheq_sites.dalux_id = DLX_2_projects.projectId`
- **Dalux Build API v2.2**, auth: single `X-API-KEY` header
- **n8n:** web UI only, no terminal access

---

## Phase Status

### ✅ PHASE 1: API Discovery (Complete)

### ✅ PHASE 2: n8n Sync Workflows (Complete)
Tasks v3 (hourly), Plans & Reference (nightly), Forms v3 (nightly).

### ✅ PHASE 3: CS053 Report Layout (Locked 16 Apr 2026)

Mock approved by Neil as Head of Assurance. Issue No. 18 (rev).

**Locked design decisions (baseline for all checklist-style templates):**
- Python + Jinja2 + WeasyPrint stack
- Inline rows per item (state pill, photo thumb, owner initials, findings)
- UDF-driven state model (`DLX_2_form_udfs.value_text` values `Green`/`Red`/`N/A`/NULL); linked CARs cross-check only
- Data quality banner surfaces inspector-intent inconsistencies
- Category headers show count chips (Green/Red/N/A, dimmed when zero)
- Inline photos 150×105px with `#N` badge
- Sequential photo numbering matched between inline and appendix
- Full-width 2-per-page photo appendix at 100mm image height
- Cross-references: Red item shows "Evidence: #N"
- Page footer single-line double-digit-safe
- Site Name / Project No. pulled from DB join (NOT UDFs — Dalux auto-populates at project level)

**See `docs/template-design-playbook.md` for the reusable design language across checklist templates.**

### ✅ PHASE 4: Web Platform — Local Prototype (Sessions 1-5 Complete)

**Stack:**
- **Backend:** Python 3.14 + FastAPI + SQLAlchemy + PyMySQL (MariaDB read-only) + SQLite (local app state)
- **Frontend:** React 18 + TypeScript + Vite + TanStack Query + react-router-dom + Tailwind
- **Auth:** None (single-user local); deferred to dev team
- **Photos:** Fetch-on-demand via Dalux API key in `.env`, cached to `backend/photo_cache/`
- **Reports:** Cached to `backend/reports_cache/` by `(form_id, form.modified)`
- **PDF generation:** WeasyPrint requires MSYS2 GTK3 runtime on PATH

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
│   │       ├── service.py  ← orchestrator + photo cache
│   │       ├── cs053.py    ← CS053 builder
│   │       ├── cs037.py    ← (new) CS037 builder — design pending
│   │       ├── templates/cs053.html.j2
│   │       ├── templates/cs037.html.j2  ← (new) pending
│   │       └── static/     ← logos + QR codes (CS053_*, CS037_* prefix naming)
│   ├── data/app.db         ← SQLite (gitignored)
│   ├── photo_cache/        ← (gitignored)
│   ├── reports_cache/      ← (gitignored)
│   ├── venv/               ← (gitignored)
│   ├── .env                ← (gitignored)
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx, main.tsx, api.ts, index.css
│   │   ├── components/NavBar.tsx
│   │   └── pages/{SitesPage,FormsPage}.tsx
│   ├── vite.config.ts      ← proxies /api → :8000
│   └── node_modules/       ← (gitignored)
├── docs/
│   ├── DALUX_PROJECT_SCOPE_vX.md (current: v3.3)
│   ├── template-design-playbook.md (new)
│   ├── claude-code-handoff.md
│   └── audit_limitations.md
└── .gitignore
```

**Endpoints (all live on :8000):**
- `GET /` — health
- `GET /api/health/db` — row counts
- `GET /api/sites` — joined site list with fallback
- `GET /api/form-types` — distinct templates with `has_custom_report` + `display_name`
- `GET /api/forms?site_id[]&form_type&date_from&date_to&status&not_downloaded_only&limit`
- `GET /api/forms/{form_id}/download` — generates/serves cached PDF, logs to `app_downloads`

**UI features (all live on :5173):**
- URL-driven filter state
- Multi-select site chip filter
- Form type dropdown with custom-report flag
- Date range + status + "not downloaded" filters
- Results table with metadata + download count + modified-since-download indicator
- Single-click PDF download per row

**Validated end-to-end with real data:**
- Carrington CS053_23 (`S430266406840305664`) — rendered correctly
- Carrington CS053_24 (`S432861154763606016`) — rendered correctly
- NESY CS053_14 (`S405358071733291008`) — rendered correctly after fallback fix
- Site Name / Project No. pulled from `sheq_sites` / `DLX_2_projects` join (NOT UDFs)
- Download count increments, audit log captured
- Modified-since-download flag working

**Notable bugs resolved (for Claude Code reference — don't repeat):**
- Collation mismatch on every join across `DLX_2_*` vs `sheq_sites` — every query requires `COLLATE utf8mb4_unicode_ci` on both sides of every join
- Circular import in `config.py`
- PowerShell AllSigned execution policy blocking npm → use `npm.cmd` prefix
- MSYS2 Python hijacking venv Python → reorder PATH: venv Scripts first, MSYS2 GTK last
- `usage` is a reserved MariaDB keyword — quote with backticks when used as column name
- Jinja `dict.items` falls back to method reference — must use `["items"]` explicitly
- Site Name / Project No. are project metadata (from `DLX_2_projects` / `sheq_sites`), not UDFs — don't look them up in form UDFs
- Category title extraction must be independent of item-state rows — use a separate query, not `WHERE value_text IN ('Green','Red','N/A')` filtered results

**Session 6 (bulk download) — Deferred. Still needed before production.**
- "Download all new (N)" button at top of filtered results
- Backend generates ZIP in background, streams to client
- Filename: `yyyy-mm-dd_bulk_download_{N}forms.zip`

**Session 7 (polish) — Deferred.**
- Admin page: unmapped sites handler, download audit log viewer
- UX tweaks from real use

### 🟡 PHASE 5: Hand-off to Dev Team (Not Started)
Local prototype working end-to-end. Dev team owns: hosting, Entra SSO, photo pre-fetch implementation, production deployment.

### 🟡 PHASE 6: Additional Report Templates (CS037 next)

**Completed templates:**
- **CS053** — Weekly Safety, Health, Environmental and Quality Inspection. Checklist style, 14 categories, UDF-driven states, linked CAR findings.

**Current design target:**
- **CS037** — Permit to Undertake Hotwork. **Different shape from CS053** — this is a **permit** not a checklist. Likely includes:
  - Permit issuer / holder / authoriser fields
  - Hot work location, time window
  - Hazard controls / mitigations checklist
  - Sign-on / sign-off / close-out
  - Probably shorter than CS053 (single work activity, not a site-wide weekly audit)
  - Dalux `template_name`: `"Permit to undertake hot work"` (exact)
  - Spencer form code: `CS037`
  - Should reuse CS053's design language where shape matches (Spencer branding, category states, photos, owner chips, page footer, filename pattern)
  - Deviate from CS053 where the permit structure demands (e.g. dedicated issuer/holder block; probably no big photo appendix; explicit validity time window; sign-off block as first-class element, not footer)

**Future target templates (priority TBC):**
- CAR/NCR reports
- Inspection plan registration reports
- Test plan registration reports
- Task action registers
- CS172 Excavation Inspection Checklist
- CS033 Record of Training/Toolbox Talk

Each new template = chat session for design, Claude Code session to wire in.

### 🔴 PHASE 7: Apache Superset Dashboards (Lower Priority)

---

## Technical Debt Log

1. **Collation mismatch** — `DLX_2_*.projectId`/`userId` uses `utf8mb4_general_ci`, `sheq_sites.dalux_id` uses `utf8mb4_unicode_ci`. Every join requires `COLLATE utf8mb4_unicode_ci` on both sides. Fix: `ALTER TABLE` to unify. Dev team owns.

2. **Per-item ownership not captured** — Dalux stores field-level change history server-side but n8n sync doesn't pull it. Only form-level `createdBy_userId` / `modifiedBy_userId` available. Report shows inspector initials (form submitter). Documented in `docs/audit_limitations.md` for dev team.

3. **Task→form linkage inferred** — `DLX_2_tasks` has no parent-form FK. Join: `(projectId, usage='SafetyIssue', DATE(created) == DATE(form.created))`. Risk: same-day double inspections cross-attribute. Not yet observed.

4. **Photo token expiry** — Dalux URL tokens may expire between sync and download. Production will pre-fetch via n8n.

5. **`sheq_sites.dalux_id` mapping incomplete** — 34 of 50 Dalux projects unmapped. Needs owner. Report fallback gracefully renders `DLX_2_projects.projectName` + `projectId` but Spencer would prefer SOS number + site_name to always appear.

6. **Existing v3 report generator uses task-derived state** — retire when new layout fully in production.

7. **Reserved word `usage` in queries** — cs053.py fixed but pattern could recur. Dev team should adopt backtick-or-alias convention for any SQL touching `DLX_2_tasks`.

8. **Every Spencer project uses the same master CS053 form template** (confirmed by Neil) — so UDF field names are consistent across projects. Design decision: pull project-level fields (Site Name, Project No., etc.) from DB join to `DLX_2_projects` / `sheq_sites`, not from UDFs. **Rule for future templates: always check whether a field is user-entered (UDF) or platform-populated (project metadata) before deciding where to pull it from.**

---

## Reference Forms

### CS053 validation set (working)

- **Carrington CS053_23** `S430266406840305664` (2 Apr 2026, closed)
  - 140 UDFs: 114 Green / 17 N/A / 1 Red (4.2 Site fenced)
  - 1 linked CAR: SI46 SECURITY Sev 2 → Anthony Smith
  - Photos: 5 (including CAR evidence)
  - Primary Phase 3 design validation form

- **Carrington CS053_24** `S432861154763606016` (9 Apr 2026)
  - 142 UDFs, 38 attachments, 2 linked CARs (SI47, SI48)
  - Primary cross-validation form

- **NESY CS053_14** `S405358071733291008` (23 Jan 2026, closed)
  - 120 UDFs: 85 Green / 0 Red / 35 N/A
  - Zero findings (common case — clean inspection)
  - Primary validation that site fallback works for non-Carrington projects
  - Project `S399195302092867585` (C2111-NESY Replacement of Steel Dock Gate)
  - Inspector: Alex Burr

### CS037 reference forms (to be identified)
- Query `DLX_2_forms WHERE template_name = 'Permit to undertake hot work' ORDER BY created DESC LIMIT 10` during design session

---

## Tools & Stack

- **Dalux Build REST API** v2.2
- **Self-hosted n8n** (UI only, no terminal)
- **On-premise MariaDB** (DBHUB.cspencerltd.co.uk via VPN)
- **Python 3.14** + VS Code + GitHub Copilot / Claude Code
- **Python packages:** fastapi, uvicorn, sqlalchemy, pymysql, python-dotenv, jinja2, weasyprint, requests
- **Node.js 24 LTS** for React frontend
- **MSYS2 GTK3** for WeasyPrint system libraries
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

---

## Key Principles

- **Contract compliance paramount** — legal dimension takes priority
- Outputs must be factual, defensible, audit-ready
- Accuracy > speed
- `userDefinedFields` stored as JSON columns given variable structure
- "NCR" doesn't exist as Dalux task type; CAR is the functional equivalent
- Render-only transformations don't mutate source data
- Secrets never committed (`.env` always gitignored)
- Local prototype first, dev team productionises — don't guess at architectural decisions they should own
- **All new SQL joins across `DLX_2_*` and `sheq_sites` tables: always add `COLLATE utf8mb4_unicode_ci` on both sides**
- **Any new report template:** design in chat, wire in via Claude Code; template PNG assets use prefix naming (`CS053_*`, `CS037_*`) so `_find_asset()` resolves by prefix
- **Before designing a new template:** sanity-check for each field whether it's user-entered (UDF) or platform-populated (project metadata). UDF → `DLX_2_form_udfs`. Platform-populated → `DLX_2_projects` / `sheq_sites` / form header columns.

---

## Git history so far

- `38883fe` — Phase A Session 1: FastAPI backend with sites endpoint
- `7b62d00` — Add SQLite support and download tracking model
- `972298d` — Phase A Session 3: React frontend scaffold with sites page
- `5d583bb` — Phase A Session 4: Forms page with URL-driven filters + routing
- `bf44329` — feat: Add CS053 Weekly Safety Inspection report generation
- `34c9ddd` — WIP: debugging CS053 SQL parameter style issue
- *(next commits applied by Claude Code)* — reserved-keyword fix, Jinja attribute fix, audit caveat removal, display_name dropdown, site_name/project_num fallback, category title extraction

---

## Immediate next actions

1. **Chat:** Design CS037 Permit to Undertake Hotwork template (this is the new chat)
2. **Claude Code:** Wire in CS037 once design approved
3. **Chat:** Design the next template after CS037 (CAR/NCR suggested)
4. **Chat + Claude Code:** Bulk download feature (Session 6, was deferred)
5. **Phase 5:** Dev team handover with working prototype
