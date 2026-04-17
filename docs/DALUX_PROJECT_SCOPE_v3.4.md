# DALUX PROJECT — SCOPE & STATUS

**Last updated:** 17 Apr 2026
**Document version:** v3.4 (CS037 locked and in production; Forms sync patched for repeating groups + signer descriptions)

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
- Report template design and iteration (CS053 done, CS037 done, CAR/NCR next suggested)
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
- Before designing a new template in chat, the latest `cs053.py` / `cs037.py` and `service.py` are pasted for ground truth
- `docs/template-design-playbook.md` captures reusable design conventions across templates
- Per-template handoff docs (e.g. `docs/CS037_claude_code_handoff.md`) capture spec+plan for each wiring session

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

### ✅ PHASE 2: n8n Sync Workflows (Complete + patched for CS037)
Tasks v3 (hourly), Plans & Reference (nightly), Forms v3 (nightly).

**CS037-related patches (17 Apr 2026):**
- `DLX_2_form_udfs` gained a `description VARCHAR(500)` column — holds signer names captured in Dalux (previously discarded)
- PK extended to `(formId, userDefinedFieldId, field_set, value_index)` so repeating-group instances (e.g. Part D persons) no longer collide on upsert
- Forms sync workflow now extracts `udf.description` into the new column

### ✅ PHASE 3: CS053 Report Layout (Locked 16 Apr 2026)

Mock approved by Neil as Head of Assurance. Issue No. 18 (rev).

**Locked design decisions (baseline for checklist-style templates):**
- Python + Jinja2 + WeasyPrint stack
- Inline rows per item (state pill, photo thumb, owner initials, findings)
- UDF-driven state model; linked CARs cross-check only
- Data quality banner surfaces inspector-intent inconsistencies
- Category headers show count chips (Green/Red/N/A, dimmed when zero)
- Inline photos 150×105px with `#N` badge, full-width 2-per-page appendix
- Site Name / Project No. pulled from DB join (NOT UDFs — Dalux auto-populates at project level)

**See `docs/template-design-playbook.md` for the reusable design language.**

### ✅ PHASE 4: Web Platform — Local Prototype (Sessions 1-5 Complete)

**Stack:**
- **Backend:** Python 3.14 + FastAPI + SQLAlchemy + PyMySQL (MariaDB read-only) + SQLite (local app state)
- **Frontend:** React 18 + TypeScript + Vite + TanStack Query + react-router-dom + Tailwind
- **Auth:** None (single-user local); deferred to dev team
- **Photos / signatures:** Fetch-on-demand via Dalux API key in `.env`, cached to `backend/photo_cache/`
- **Reports:** Cached to `backend/reports_cache/` by `(form_id, form.modified)`
- **PDF generation:** WeasyPrint + MSYS2 GTK3 runtime on PATH
- **Timezones:** `zoneinfo` + `tzdata` (required on Windows for IANA zone lookup)

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
│   │       ├── cs053.py    ← CS053 builder
│   │       ├── cs037.py    ← CS037 builder (Family B — permit)
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
│   ├── DALUX_PROJECT_SCOPE_vX.md (current: v3.4)
│   ├── template-design-playbook.md
│   ├── CS037_claude_code_handoff.md
│   ├── cs037_mock_v0.6.{html,pdf}
│   ├── claude-code-handoff.md
│   └── audit_limitations.md
├── docker-compose.yml, DOCKER_SETUP.md, Dockerfiles (packaging for colleagues)
└── .gitignore
```

**Endpoints (all live on :8000):**
- `GET /` — health
- `GET /api/health/db` — row counts
- `GET /api/sites` — joined site list with fallback
- `GET /api/sites/form-summary` — per-project undownloaded + stale counts
- `GET /api/form-types` — distinct templates with `has_custom_report` + `display_name` (now includes CS037)
- `GET /api/forms?site_id[]&form_type&date_from&date_to&status&not_downloaded_only&limit`
- `GET /api/forms/{form_id}/download` — generates/serves cached PDF, logs to `app_downloads`
- `POST /api/forms/bulk-download` — ZIP of selected PDFs

**UI features (all live on :5173):**
- URL-driven filter state
- Multi-select site chip filter with severity tiers (green/amber/red by stale-undownloaded count)
- Form type dropdown with custom-report flag
- Date range + status + "not downloaded" filters
- Results table with metadata + download count + modified-since-download indicator
- Checkbox multi-select + bulk ZIP download
- Open-status warning before download (audit safeguard)

**Validated end-to-end with real data:**

CS053:
- Carrington CS053_23 (`S430266406840305664`), CS053_24 (`S432861154763606016`)
- NESY CS053_14 (`S405358071733291008`)

CS037 (added 17 Apr 2026):
- Menai Bridge CS037_8 (`S427377143454894080`) — primary validation (3 pages, 5 signatures, 2 Part D persons, closed)
- Kessock CS037_1 (`S405283324253177856`) — expired-open form (red chip)
- Kessock CS037_3 (`S432801637065558016`) — post-DST BST label verification
- Sandbox CS037_1 (`S401406462607230976`) — different project's site mapping

**Notable bugs resolved (for future reference — don't repeat):**
- Collation mismatch on every join across `DLX_2_*` vs `sheq_sites` — every query requires `COLLATE utf8mb4_unicode_ci` on both sides of every join
- Circular import in `config.py`
- PowerShell AllSigned execution policy blocking npm → use `npm.cmd` prefix
- MSYS2 Python hijacking venv Python → reorder PATH: venv Scripts first, MSYS2 GTK last
- `usage` is a reserved MariaDB keyword — quote with backticks when used as column name
- Jinja `dict.items` falls back to method reference — must use `["items"]` explicitly
- Site Name / Project No. are project metadata (from `DLX_2_projects` / `sheq_sites`), not UDFs — don't look them up in form UDFs for checklist templates
- Category title extraction must be independent of item-state rows — use a separate query
- **Windows Python 3.14 has no bundled IANA tz data** — `zoneinfo.ZoneInfo("UTC")` throws `ZoneInfoNotFoundError` unless the `tzdata` package is installed. Pinned in `requirements.txt`.
- **CS037 Part D attachment lookup key**: UDF `field_set` is form-id-prefixed (`S427...080_20260219...-e6bb86cd`) but the matching `form_attachments.udf_set` stores only the suffix (`20260219...-e6bb86cd`). Builder must strip the `{formId}_` prefix before lookup or Part D signatures fetch silently fail.

**Deferred / follow-on work (still needed before production):**
- Bulk download UX polish — CSV export of filtered list alongside ZIP
- Admin page: unmapped sites handler, download audit log viewer
- CS037 size-class thresholds hold for today's site-name set; may need calibration if a site longer than Kessock's 32-char name is added to `sheq_sites`

### 🟡 PHASE 5: Hand-off to Dev Team (Not Started)
Local prototype working end-to-end. Dev team owns: hosting, Entra SSO, photo pre-fetch implementation, production deployment. Docker Compose packaging now in place for colleague distribution (see `DOCKER_SETUP.md`).

### 🟡 PHASE 6: Additional Report Templates

**Completed templates:**
- **CS053** — Weekly Safety, Health, Environmental and Quality Inspection. Checklist style, 14 categories, UDF-driven states, linked CAR findings. Locked 16 Apr 2026.
- **CS037** — Permit to Undertake Hot Work. Permit style (Family B). 3-page A4, validity block with GMT/BST handling, Part B 13 precautions, Part D repeating group with per-instance signatures. Locked 17 Apr 2026.

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

2. **Per-item ownership not captured** — Dalux stores field-level change history server-side but n8n sync doesn't pull it. Only form-level `createdBy_userId` / `modifiedBy_userId` available. Report shows inspector/submitter initials. Documented in `docs/audit_limitations.md` for dev team.

3. **Task→form linkage inferred** — `DLX_2_tasks` has no parent-form FK. Join: `(projectId, usage='SafetyIssue', DATE(created) == DATE(form.created))`. Risk: same-day double inspections cross-attribute. Not yet observed.

4. **Photo / signature token expiry** — Dalux URL tokens may expire between sync and download. Production will pre-fetch via n8n. Also applies to CS037 signature PNGs.

5. **`sheq_sites.dalux_id` mapping incomplete** — 34 of 50 Dalux projects unmapped. Needs owner. Report falls back to `DLX_2_projects.projectName` + `number` but Spencer would prefer SOS number + site_name to always appear.

6. **Existing v3 report generator uses task-derived state** — retire when new layout fully in production.

7. **Reserved word `usage` in queries** — cs053.py fixed but pattern could recur.

8. **Every Spencer project uses the same master form templates** (confirmed for CS053 and CS037) — UDF field names are consistent across projects. **Rule for future templates: always check whether a field is user-entered (UDF) or platform-populated (project metadata) before deciding where to pull it from.**

9. **[RESOLVED 17 Apr 2026]** Forms-sync schema gaps — `DLX_2_form_udfs` was discarding `udf.description` (signer names) and its PK didn't include `field_set`, so repeating-group upserts collided. Fixed by adding the `description VARCHAR(500)` column and extending the PK to include `field_set`. Verification queries live in `docs/CS037_claude_code_handoff.md`.

10. **CS037 site-source deviation from CS053 convention** — CS037 display + filename use `DLX_2_projects.projectName` first (falling back to `sheq_sites.site_name`), whereas CS053 uses `sheq_sites.site_name` first. Reason: CS037's identifier grid already shows the SOS number in a dedicated cell, so duplicating a SOS-prefixed site name would waste space and force auto-shrink. Family B (permit) design decision per `docs/template-design-playbook.md` "When to deviate". Only affects the CS037 builder; CS053 unchanged.

---

## Reference Forms

### CS053 validation set

- **Carrington CS053_23** `S430266406840305664` (2 Apr 2026, closed) — 140 UDFs, 1 linked CAR
- **Carrington CS053_24** `S432861154763606016` (9 Apr 2026) — 142 UDFs, 2 CARs
- **NESY CS053_14** `S405358071733291008` (23 Jan 2026, closed) — 120 UDFs, zero findings; validates site fallback for non-Carrington projects

### CS037 validation set

- **Menai Bridge CS037_8** `S427377143454894080` (25 Mar 2026, closed) — primary validation form. 28 UDFs, 5 signatures, 2 Part D persons (Charlie Cook / Charlie cook — case verbatim). 3-page A4 output. Filename: `2026-03-13_CS037_MenaiBridge_S427377143454894080.pdf`.
- **Kessock CS037_1** `S405283324253177856` (23 Jan 2026, open) — validates "Expired" red status chip (open form past To-date). Long site name validates auto-shrink len-md. Permit Controller UDF missing → "Signature not synced" placeholder renders correctly with fallback user name from `createdBy_userId`.
- **Kessock CS037_3** `S432801637065558016` (8 Apr 2026, open) — validates BST label for post-DST permits (validity 10 Apr 2026 BST). 6 Part D instances (all "(unknown)" signer fallback — data edge case).
- **Sandbox CS037_1** `S401406462607230976` (12 Jan 2026, closed) — validates different project's site mapping (project `S313997131771805696`, Sandbox).

---

## Tools & Stack

- **Dalux Build REST API** v2.2
- **Self-hosted n8n** (UI only, no terminal)
- **On-premise MariaDB** (DBHUB.cspencerltd.co.uk via VPN)
- **Python 3.14** + VS Code + GitHub Copilot / Claude Code
- **Python packages:** fastapi, uvicorn, sqlalchemy, pymysql, python-dotenv, jinja2, weasyprint, requests, tzdata
- **Node.js 24 LTS** for React frontend
- **MSYS2 GTK3** for WeasyPrint system libraries (local dev) / GTK3 apt packages in Docker image
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
- **Any new report template:** design in chat, wire in via Claude Code; template PNG assets use prefix naming (`CS053_*`, `CS037_*`) so `_find_asset()` resolves by prefix
- **Match UDFs by `field_name`, not `field_key`** — names are stable once forms close; keys change across template issues (confirmed for CS037)
- **Before designing a new template:** sanity-check for each field whether it's user-entered (UDF) or platform-populated (project metadata)
- **For repeating-group UDFs (e.g. CS037 Part D):** attachments join by `(udf_key, udf_set)` where `udf_set` is the un-prefixed suffix of the UDF's `field_set`

---

## Git history so far

- `38883fe` — Phase A Session 1: FastAPI backend with sites endpoint
- `7b62d00` — Add SQLite support and download tracking model
- `972298d` — Phase A Session 3: React frontend scaffold with sites page
- `5d583bb` — Phase A Session 4: Forms page with URL-driven filters + routing
- `bf44329` — feat: Add CS053 Weekly Safety Inspection report generation
- `34c9ddd` — WIP: debugging CS053 SQL parameter style issue
- *(intervening commits — reserved-keyword fix, Jinja attribute fix, audit caveat removal, display_name dropdown, site_name/project_num fallback, category title extraction, VSCode settings, Docker packaging)*
- `f0d993b` — feat: add CS037 Permit to Undertake Hotwork template and design playbook
- *(next)* — feat: Add CS037 Permit to Undertake Hot Work report generation

---

## Immediate next actions

1. **Claude Code:** Commit CS037 wiring (this session's output)
2. **Chat:** Design next template — CAR/NCR suggested (Family D), CS033 toolbox-talk (Family C), or CS172 excavation checklist (Family A) — Neil's call
3. **Chat + Claude Code:** Review real-world CS037 usage once colleagues try it via Docker; iterate if visual issues surface
4. **Phase 5:** Dev team handover — working prototype + Docker distribution in place
