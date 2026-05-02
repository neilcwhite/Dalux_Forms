# Dalux Forms Portal — Engineering Handoff

**Audience:** Spencer dev team + IT, reviewing the codebase before sign-off.
**Author context:** Built collaboratively with an AI coding assistant under Neil White's direction. This document is written in the voice of the team-lead handing the project over — honest about trade-offs, specific about decisions, and pre-empting the questions a sceptical senior reviewer should ask.

---

## TL;DR

A FastAPI backend + React frontend that turns Spencer's Dalux form data into branded PDF reports, surfaces operational dashboards, and gives doc control a notification stream for closed forms. ~9,000 lines of code spanning roughly two weeks of focused work. Three explicit stop-gaps (auth, template upload, single-instance scheduler) are documented with their replacement paths. Deploy posture is **VPN-only**, single Docker host, alongside the existing MariaDB and n8n. The codebase is honest about its limits — most things you'd flag in review are already called out in code comments or planning docs.

---

## 1. Architecture at a glance

```
                                  ┌─────────────────┐
                                  │   Spencer VPN   │
                                  └────────┬────────┘
                                           │
   ┌───────────────────────────────────────┼─────────────────────────────────┐
   │                            On-prem Docker host                          │
   │                                                                          │
   │   ┌──────────────┐    ┌──────────────────┐    ┌─────────────────────┐  │
   │   │   nginx      │───▶│  React frontend  │    │   FastAPI backend   │  │
   │   │   (port 80)  │    │  (Vite build,    │    │   (uvicorn, 8000)   │  │
   │   │              │    │   served static) │    │                     │  │
   │   └──────────────┘    └──────────────────┘    │   ┌──────────────┐  │  │
   │                                                │   │  /api/auth   │  │  │
   │                                  proxy /api/   │   │  /api/forms  │  │  │
   │                                  ◀────────────│   │  /api/sites  │  │  │
   │                                                │   │  /api/admin  │  │  │
   │                                                │   │  /api/dashboard│  │  │
   │                                                │   │  /api/activity│  │  │
   │                                                │   └──────┬───────┘  │  │
   │                                                │          │          │  │
   │   ┌──────────────────┐                         │   ┌──────┴───────┐  │  │
   │   │ SQLite app.db    │◀────────────────────────│──▶│ APScheduler  │  │  │
   │   │ - downloads      │                         │   │ (notifications)│  │  │
   │   │ - notifications_sent│                      │   └──────┬───────┘  │  │
   │   │ - unmapped_template_alerts │                │          │          │  │
   │   │ - hidden_projects│                         │          │          │  │
   │   │ - template_uploads_audit │                 └──────────┼──────────┘  │
   │   │ - approved_users │                                    │             │
   │   └──────────────────┘                                    │             │
   │                                                           ▼             │
   │   ┌─────────────────────┐                          ┌──────────────┐    │
   │   │ MariaDB (DBHUB)     │◀─── reads ───────────────│ render PDF +  │   │
   │   │ - DLX_2_forms       │                          │ upload to SP  │───┼──▶ SharePoint
   │   │ - DLX_2_form_udfs   │                          │ (Graph API)   │   │   (01 New Documents)
   │   │ - DLX_2_projects    │                          └──────┬───────┘    │
   │   │ - sheq_sites        │                                 │            │
   │   │ - DLX_2_users       │                                 ▼            │
   │   └─────────────────────┘                          ┌──────────────┐    │
   │                                                    │ Power Automate│   │
   │                                                    │ × 2 flows     │───┼──▶ Teams
   │                                                    │ (HTTP triggers)│  │   (doc-control + Neil)
   │                                                    └──────────────┘    │
   └─────────────────────────────────────────────────────────────────────────┘
```

**Key facts:**
- Two databases: **MariaDB** (Dalux + SHEQ data, read-only from this app's perspective) and **SQLite** (everything app-local — auth, audit logs, dedup tables).
- One scheduled job (Teams notifications) runs in-process via APScheduler. Same tick handles two paths: closed-form notifications and unmapped-template pings.
- Two outbound webhooks (Power Automate, one per Teams flow) plus Microsoft Graph (SharePoint upload).
- The app reads but never writes to MariaDB. Writes to SQLite only.

---

## 2. Repository tour

```
backend/
  app/
    main.py                  ← FastAPI app + ~10 endpoints not big enough to warrant their own router
    auth.py                  ← Login + user CRUD (router)
    dashboard.py             ← /api/dashboard/* + /api/activity (router)
    config.py                ← Env-var loaded settings
    database.py              ← SQLAlchemy engines (MariaDB + SQLite)
    models.py                ← SQLite models only — MariaDB is text() queries
    notifications/           ← APScheduler + render → SharePoint → Teams
      service.py             ← closed-form path: query + dedup + render + upload + send
      unmapped.py            ← unmapped-template ping path (per-template-per-day dedup)
      scheduler.py           ← cron wiring
      backfill.py            ← one-shot CLI for first deploy
      run_now.py             ← manual trigger CLI (--dry-run, --no-teams flags)
    sharepoint/              ← Microsoft Graph client (token cache + upload)
      client.py              ← simple PUT (<4 MB) + upload session (>= 4 MB)
      test_connection.py     ← connectivity smoke-test CLI
    reports/                 ← PDF report builders (CS037, CS053, CS208)
      service.py             ← orchestration: form → handler → WeasyPrint → cache
      cs037.py / cs053.py / cs208.py
      templates/             ← Jinja2 .html.j2 files + shared design system partial
    templates_userland/      ← Hot-uploadable handlers (importlib at runtime)
      loader.py              ← version registry, resolver, mutation primitives
      admin.py               ← upload/disable/enable/delete endpoints (router)
      runtime.py             ← Jinja env helper for uploaded modules

frontend/
  src/
    api.ts                   ← Single source of truth for HTTP client + types
    App.tsx                  ← Route table + AuthProvider + RequireAuth wrapper
    auth/AuthContext.tsx     ← localStorage session + signIn/signOut
    components/
      Sidebar.tsx, TopBar.tsx, ui.tsx ← UI primitives (Card, Tag, Button, etc.)
      dashboard/charts.tsx, kpi.tsx   ← chart primitives, KPI tile shapes
    pages/
      DashboardPage / MetricsPage / SectorsPage / ProjectDashboardPage
      FormsPage / SitesPage / AdminPage / LoginPage
    index.css                ← Tailwind v4 @theme tokens (light + dark mode)

docs/
  deployment_handoff.md      ← Step-by-step for IT
  template_upload_plan.md    ← Architecture + status log for the upload feature
  teams_notifications_plan.md ← Same for the notifications feature
  engineering_handoff.md     ← This document
  template_design_system_v1.md ← How report templates are styled
  cs037_*.md / cs053_*.md    ← Per-template design history (mostly archived)
```

**Naming conventions** are consistent (snake_case in Python, camelCase in TS, kebab-case in URL paths). Module docstrings explain "why this file exists" up front; this is the single most useful thing for a reviewer dropping into a file cold.

---

## 3. Design decisions worth defending

These are the calls a reviewer is most likely to question. Each comes with the reasoning so we can have the conversation rather than litigate it from scratch.

### 3.1 Two databases (MariaDB read-only, SQLite for app state)

**The call:** This app never writes to DBHUB MariaDB. All app state — downloads audit, notification dedup, hidden-project flags, approved users, template upload audit — lives in SQLite at `backend/data/app.db`.

**Why:**
- Spencer's MariaDB holds Dalux/SHEQ data with established backup, audit, and access controls. Adding write tables there means asking IT for INSERT/UPDATE/DELETE grants on per-table basis, plus expanding their backup scope.
- App-local data (audit logs, dedup tables, user records) is conceptually separate from the operational data DBHUB serves.
- SQLite keeps the app self-contained — works the same on any developer machine, no DB-permission setup.

**What it costs:** SQLite isn't shared across instances. If we ever scale horizontally (multiple FastAPI containers), state becomes inconsistent. Documented as known limitation in §6. Acceptable now because the deployment is single-host.

**Where reviewers will land:** A senior dev might prefer "everything in MariaDB" for operational consistency. That's defensible; the migration is mechanical (~2 hours per table, mostly schema + connection swap). The choice was deliberate, not accidental.

### 3.2 Backend endpoints are not authenticated; VPN is the trust boundary

**The call:** `/api/forms`, `/api/dashboard/*`, `/api/sites` etc. accept any caller. There's no JWT validation, no session check, no API token. Auth is enforced only on the frontend (App.tsx → RequireAuth → /login).

**Why:**
- The deployment plan is VPN-only behind nginx on a single host alongside MariaDB. Inside the VPN we have an established trust posture (people inside have a job to do here).
- Adding API-level auth would mean: middleware on every endpoint, signed sessions, token refresh logic, dev-environment auth for local testing, and refactoring every smoke test we have. That's days of work for a stop-gap that gets replaced by Azure Entra later.
- The auth UI we have provides accountability (who-did-what audit trail in `last_login_at` and the audit tables) and a discoverability gate (random users on the VPN don't accidentally find the URL and start clicking).

**What it costs:** Anyone with VPN access can `curl http://<host>:8000/api/forms` and get data without logging in. They can't *do* anything destructive over GET endpoints, but the data isn't gated.

**Where reviewers will land:** This is the single biggest call-out for review. Two valid responses:
1. **Accept** — VPN is the trust boundary; this is pre-Entra; defer until SSO ships.
2. **Add an API token middleware** — middleware on a `_require_session_header` dep, frontend sends a token via interceptor, ~half a day of work. Token can be the same value as the bcrypt hash with a salt server-side. Doable when needed.

I'd defer this until Entra unless IT explicitly asks for it.

### 3.3 Template upload is RCE-as-a-service (intentional)

**The call:** [`POST /api/admin/templates/upload`](backend/app/templates_userland/admin.py) accepts arbitrary `.py` and `.html.j2` files, persists them to a Docker volume, and dynamically imports the `.py` via `importlib`. The imported module's top-level code runs on import. This is, by design, **remote code execution gated by a single shared admin token**.

**Why this exists:**
- Spencer wants ~12 more form-report templates over the next year. Each currently requires a code change → Docker rebuild → IT signoff. That cadence stalls delivery.
- Letting Neil drop new template handlers in via an admin web form takes IT off the critical path for content updates.

**The mitigations:**
- `ADMIN_UPLOAD_TOKEN` env var must match the `X-Admin-Token` header. If the env var is empty, the endpoint returns 503 (feature disabled). Token is set per-deployment by IT and shared with Neil only.
- Every upload (success and rejection) writes a row to `template_uploads_audit` with timestamp, source IP, file SHA-256s, and outcome. IT can query this any time.
- Built-in templates (CS037/CS053/CS208) are immutable — uploads can add new versions on top of them but never delete or replace them.
- Validation gate: a malformed `.py` is imported in a temp directory first; if it doesn't expose the required protocol (`DALUX_TEMPLATE_NAME`, `FORM_CODE`, `VALID_FROM`, `build_payload`, `render_html`) the upload is rejected before any file lands on the volume.

**Where reviewers will land:** Two valid responses:
1. **Accept with the documented mitigations** — token-gated, VPN-protected, audited, and replaceable with proper signed-package distribution later if scale demands.
2. **Reject and require a signed-package model** — uploads must be signed with an internal cert, etc. Doable, ~2 days of work, defers the original delivery problem.

The deployment_handoff has this written up explicitly in Step 6 so IT signs off knowing what they're enabling. This isn't an oversight; it's a documented design.

### 3.4 Raw SQL via `text()` instead of full ORM

**The call:** Most endpoints (especially `dashboard.py` and the `/api/forms` listing) use `db.execute(text("SELECT ..."))` rather than the SQLAlchemy ORM.

**Why:**
- The dashboard queries are aggregation-heavy with multi-table COLLATE-decorated joins (`f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci` — see §3.6). Translating these to ORM expressions adds noise without buying us anything; the ORM doesn't have a clean idiom for explicit collation hints.
- All bind parameters are properly named-bound (`:fid`, `:t{i}` etc.), never concatenated. There's no SQL injection risk; this is `text()` used correctly.
- Dashboard queries are read-heavy. The ORM's strength (change-tracking, identity map, relationship loading) doesn't apply.

**What it costs:** A future maintainer needs to know SQL. They will.

**Where reviewers will land:** A senior dev might prefer ORM for the simpler queries (e.g. `/api/admin/users` is straight ORM already — see [`auth.py`](backend/app/auth.py)). The mixed approach is fine; the line is "use ORM for CRUD on local tables, raw SQL for cross-database analytics." That's a defensible boundary.

### 3.5 `_TemplatesWithCustomReportProxy` in main.py

**The call:** [`main.py:74-99`](backend/app/main.py) has a small proxy class that lets call-sites keep using `TEMPLATES_WITH_CUSTOM_REPORT.get(...)` and `name in TEMPLATES_WITH_CUSTOM_REPORT` while the underlying data has moved to a live registry in `templates_userland.loader`.

**Why:** When we made the template registry dynamic (uploaded templates can come and go), the old hardcoded dict in main.py needed to become a live lookup. Five call-sites used the old `TEMPLATES_WITH_CUSTOM_REPORT.get(...)` API. The proxy class avoids touching all five.

**Where reviewers will land:** Could have been a function (`get_templates_with_custom_report().get(...)`) at all call sites. The proxy preserves the dict-like API at the cost of one tiny class. Mild aesthetic preference either way; both are correct.

### 3.6 Every join uses `COLLATE utf8mb4_unicode_ci` on both sides

**The call:** Every JOIN between Dalux tables uses explicit collation hints:

```sql
LEFT JOIN sheq_sites s
  ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
```

**Why:** `DLX_2_forms.projectId` and `sheq_sites.dalux_id` were created with different default collations. Joining without explicit collation produces "Illegal mix of collations" errors. This is a **technical debt of the upstream sync**, not the app — but the app has to work around it on every join. Documented in `docs/DALUX_PROJECT_SCOPE_v4.0.md` Technical Debt §1. Removing this requires a migration of the source tables, which is out of scope here.

**Where reviewers will land:** Ugly, defensible, fixable upstream.

---

## 4. Security model — honestly stated

| Layer | Status | Notes |
|---|---|---|
| Network perimeter | VPN-only | The actual security boundary. Not configured by the app — IT's responsibility |
| Frontend auth gate | Email + bcrypt | RequireAuth bounces unauthenticated users to /login. UX boundary, not a trust boundary |
| Backend API auth | **Not implemented** | curl from inside the VPN works without a session. Documented call-out (§3.2) |
| Password storage | bcrypt (salted, hashed) | passlib + bcrypt 4.0.1, correct usage. SQLite app.db |
| Template upload | Single shared admin token | Documented as RCE-as-a-service (§3.3), audited |
| Power Automate webhook | SAS-signed URL in env | Treated as a secret. `chmod 600 .env` in deployment instructions |
| Data at rest | Unencrypted SQLite | Acceptable inside the encrypted Docker host filesystem; would need work for cloud |
| Data in transit | nginx terminates TLS (deployment concern, not app concern) | Out of scope for this codebase |
| CSRF / rate-limit / MFA | None | Acceptable inside VPN; revisit when Entra ships |

**Bottom line for IT:** treat this as an internal tool that delegates security to the network perimeter. Don't expose it beyond the VPN. The app-layer auth is for accountability, not security.

---

## 5. Test posture

**What exists:**
- Manual smoke-test scripts run during the build session for each major feature: auth bootstrap + login flow, dashboard endpoints with real data, template upload v1+v2 + rollback, notifications dedup. Each is a Python one-liner against the FastAPI TestClient that exercises the happy path + rejection paths.
- Frontend has TypeScript strict + Vite production-build verification. Not a test, but catches integration breakage that purely-runtime bugs slip past.

**What does not exist:**
- No `pytest` suite. No CI. No coverage measurement.
- No frontend component tests (no Vitest/Jest config).

**Why this is the way it is:**
- The codebase iterated quickly during a single concentrated build; tests would have been rewritten three times. Adding them now is the right next step.
- Most code paths exercise real DB data on every request — a bug surfaces in seconds during dev.

**What to add first:**
1. Backend `pytest` covering: auth bootstrap, login + change-password roundtrip, template upload validation gate, notification dedup against fixtures. ~1 day of work.
2. CI: GitHub Actions → run pytest + frontend `tsc -b` + `vite build` on every push. Half a day.
3. Frontend component tests if the UI starts churning. Defer until then.

**Honest call:** the lack of an automated test suite is the biggest gap in the codebase. Acceptable for a small team running smoke tests by hand on each deploy, not acceptable long-term. Tracked in §6.

---

## 6. Known limitations / tech debt

Tracked here so review doesn't surface them as discoveries.

| Item | Severity | Reasoning / replacement path |
|---|---|---|
| **No automated test suite** | High | Add pytest backend tests + CI. ~1.5 days. |
| **Backend API not authenticated** | Medium (acceptable inside VPN) | Add a session-token middleware when Entra ships, or sooner if VPN posture changes |
| **Single-instance APScheduler** | Medium (single Docker host) | If we scale to multiple containers, switch to a dedicated scheduler container or a distributed lock |
| **`@app.on_event("startup")` deprecated** | Low | FastAPI prefers `lifespan` context managers in 0.105+. We're on 0.104.1. Migrate when we bump versions |
| **bcrypt pinned to 4.0.1** | Low | passlib 1.7.4 reads `bcrypt.__about__.__version__` which 4.1+ removed. Comment in requirements.txt explains. Drop the pin when passlib 1.7.5+ is released |
| **Sector aliasing hardcoded** | Low | `_SECTOR_ALIASES` in [dashboard.py](backend/app/dashboard.py) maps "M&E" → "Rail". Fine as a stop-gap; if more sectors merge, push to a `sector_aliases` table |
| **"Soon" placeholders in Sidebar** | Low | Settings + Audit log are forward-looking, not built. Either ship them or remove the entries |
| **Hardcoded sector colours** | Low | [`charts.tsx` SECTOR_COLORS](frontend/src/components/dashboard/charts.tsx). Six sectors enumerated; new ones get a default grey. Configurable later if needed |
| **No FastAPI `/docs` (Swagger UI) enabled** | Low | Add `app = FastAPI(docs_url="/docs")` if useful for backend devs. One-line change |
| **First-run flood prevention is mandatory** | Operational | The closed-form notifications backfill must run on first deploy or doc control gets ~30 historical alerts. Documented in deployment_handoff.md Step 4. The unmapped-template path auto-bootstraps when its table is empty (no separate CLI). Hard to make either idempotent without losing the bootstrap signal |
| **No Power Automate retry queue** | Medium | A failed POST is logged with `status='failed'` but not retried in-process. Retried implicitly on next scheduler run. SharePoint upload uses `conflictBehavior=replace` so re-upload is safe. Acceptable while both are reliable; switch to a proper retry/DLQ pattern if not |
| **SharePoint auth piggybacks on n8n's Azure AD app reg** | Medium | Stop-gap. IT to issue a dedicated Dalux Forms registration with `Sites.Selected` scoped to `01 New Documents` only. Until then, our blast radius is whatever n8n's reg has access to (currently SharePoint write across the tenant) |
| **Power Automate HTTP trigger is now Premium** | Medium | Microsoft reclassified the trigger as Premium during 2024–2025. Existing flows still run; admin needs to take ownership of (or assign per-flow Premium plans to) the two flows before enforcement. Long-term escape: replace Power Automate with direct Graph API posting from FastAPI — same Azure AD app reg, ~half-day work |
| **Frontend has no global error boundary** | Low | A single render error blanks the page (we hit this once, fixed in [SitesPage hooks-rules fix](https://github.com/neilcwhite/Dalux_Forms/commit/248dfa2)). Add an ErrorBoundary at App level for resilience |

---

## 7. Operational notes

### First deployment

1. Clone repo to the Docker host
2. Create `backend/.env` from the template in [`docs/deployment_handoff.md`](docs/deployment_handoff.md) Step 2 (DB creds, Dalux API key, Power Automate URL, the six SHAREPOINT_* vars + folder view URL, ADMIN_UPLOAD_TOKEN, INITIAL_ADMIN_EMAILS, INITIAL_ADMIN_PASSWORD)
3. `docker-compose build && docker-compose up -d`
4. **Verify SharePoint connectivity:** `docker-compose exec backend python -m app.sharepoint.test_connection` — expect a PASS with a SharePoint URL printed. If it fails, the closed-form pipeline is broken before the Teams card; diagnose against the helpful error codes in the test docstring before continuing
5. **Run notification backfill:** `docker-compose exec backend python -m app.notifications.backfill` — **this is mandatory** or the Teams channel gets flooded with historical-form alerts on the first scheduler run. The unmapped-template path auto-bootstraps on first scheduler run; no separate CLI
6. Set `NOTIFY_ENABLED=true` in `.env`, `docker-compose restart backend`
7. Log in as the bootstrap admin, change password via TopBar → user menu → Change password

### Backups (priority order)

1. **`backend/data/app.db`** — daily. Loss = re-run notification backfill (creates a flood-risk window) + lose the user list (requires re-bootstrap from env) + lose the template-upload audit history
2. **`backend/data/templates_userland/`** — daily. Loss = re-upload custom templates from local copies
3. `backend/photo_cache/` and `backend/reports_cache/` — best-effort. They auto-rebuild on demand from MariaDB + Dalux API

### Logs to watch

- `docker-compose logs backend | grep -i notification` — scheduler runs and Power Automate dispatches
- `docker-compose logs backend | grep -i upload` — template-upload activity (should match `template_uploads_audit` table)
- `docker-compose logs backend | grep -i ERROR` — anything that should not be there

### Routine admin tasks

- **Add a new user:** Admin → Users tab → Add user (email + initial password). Tell them their password securely.
- **Reset a forgotten password:** Admin → Users tab → Reset pw → set a new one and tell the user securely.
- **Hide a project from the worklist:** Admin → Projects tab → Hide.
- **Upload a new report template:** Admin → Templates tab → upload `.py` + `.html.j2` pair.

---

## 8. Suggested review reading order

For a reviewer with ~2 hours, in priority order:

1. **This document** (you're here)
2. [`docs/deployment_handoff.md`](docs/deployment_handoff.md) — what IT actually has to do
3. [`backend/app/main.py`](backend/app/main.py) — startup hooks + the unguarded endpoints + the proxy class
4. [`backend/app/auth.py`](backend/app/auth.py) — bcrypt usage, login flow, bootstrap
5. [`backend/app/templates_userland/loader.py`](backend/app/templates_userland/loader.py) + [`admin.py`](backend/app/templates_userland/admin.py) — the RCE feature, mitigations
6. [`backend/app/dashboard.py`](backend/app/dashboard.py) — the SQL-heavy analytics
7. [`backend/app/notifications/service.py`](backend/app/notifications/service.py) — dedup logic, scheduler integration
8. [`frontend/src/App.tsx`](frontend/src/App.tsx) + [`frontend/src/auth/AuthContext.tsx`](frontend/src/auth/AuthContext.tsx) — frontend auth gate
9. [`frontend/src/api.ts`](frontend/src/api.ts) — the entire HTTP surface in one file
10. [`docs/template_upload_plan.md`](docs/template_upload_plan.md) + [`docs/teams_notifications_plan.md`](docs/teams_notifications_plan.md) — the design rationales for the two non-trivial features

The report builders ([`backend/app/reports/`](backend/app/reports/)) are deep, domain-heavy, and best reviewed alongside [`docs/template_design_system_v1.md`](docs/template_design_system_v1.md) when there's a specific reason to (e.g. fixing a CS053 layout bug). Skim on a first pass.

---

## 9. Open questions for the team

1. **Tests**: pytest + CI now, or after Entra? Recommend now.
2. **API auth middleware**: defer to Entra (recommended) or add a stop-gap session-header check? IT's call.
3. **Settings + Audit log pages**: build them, or remove the "Soon" entries from the Sidebar? Either works.
4. **Backup of SQLite**: integrated into existing backup tooling, or a new cron? IT's call.
5. **`@app.on_event` migration**: bundled with a FastAPI version bump, or do the migration ahead of that? Either works.

---

## 10. Honest closing note

This codebase was built collaboratively with an AI assistant under direct guidance. That carries a credibility tax. The mitigation is in the document you're reading — every non-obvious decision is explained, every trade-off is acknowledged, every limitation is logged. If reviewers find an issue not in this document, that's a real finding and worth a fix; if they find something already in this document, it's the start of the right conversation.

The code itself is conventional FastAPI + React. There's nothing exotic. A senior dev who knows both stacks can productively work on it within an hour. The integration with MariaDB, Power Automate, and the Dalux API is the only domain-specific piece, and that's documented in the design plans referenced above.

— End of handoff —
