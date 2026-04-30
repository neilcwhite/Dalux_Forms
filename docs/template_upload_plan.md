# Custom Form Template Upload — Plan

## Status log

| Date | Milestone | Status |
|---|---|---|
| 2026-04-30 | Architecture agreed (HTTP upload, admin-token-gated), plan written | ✅ Done |
| 2026-04-30 | Versioning model added: auto-incremented `vN` slots + `VALID_FROM` resolution against `form.created` | ✅ Done |
| 2026-04-30 | Backend: `templates_userland/` volume + `loader.py` (importlib + version resolver + Jinja runtime helper) | ✅ Done |
| 2026-04-30 | Backend: `service.py` resolver wired to use loader; `TEMPLATES_WITH_CUSTOM_REPORT` proxy in `main.py` | ✅ Done |
| 2026-04-30 | Backend: `TemplateUploadAudit` model + admin router (upload / list / audit / disable / enable / delete) | ✅ Done |
| 2026-04-30 | `ADMIN_UPLOAD_TOKEN` config + `python-multipart` dep + docker-compose env + .gitignore | ✅ Done |
| 2026-04-30 | End-to-end backend smoke (11 cases): upload v1+v2, dedup, disable→fallback→enable, delete, builtin protected, audit log | ✅ Done |
| 2026-04-30 | Frontend: Templates tab on AdminPage (upload form with stored token, version table, audit list) | ✅ Done |
| 2026-04-30 | `docs/deployment_handoff.md` Step 6 — "Template upload feature" written for IT signoff | ✅ Done |
| — | First real custom-template upload via the new flow (post-IT-signoff, prod) | ⬜ Not started |

_Update this table as work lands._

---

## Context

The IT team needs to sign off on the Docker image before this app can ship. Each form-report (CS037, CS053, CS208 today, ~12 more on the roadmap) currently requires a code change + Docker rebuild + IT review. That cadence won't scale: it puts every new form on IT's critical path and stalls delivery.

This feature lets the user (Neil) upload a `.py` builder + `.html.j2` template pair through an admin web form, validated and registered live without restarting the container. IT signs off the image once; new form types can ship without their involvement.

Built-in templates (CS037/CS053/CS208 — the ones shipped inside the Docker image) remain locked. Only user-supplied templates land in the upload volume. This preserves the audit trail for the platform itself while giving Neil a self-serve channel for content.

---

## Recommended Architecture

```
                Admin UI (/admin → Templates tab)
                            │
                            │ POST multipart  +  X-Admin-Token header
                            ▼
              FastAPI  /api/admin/templates/upload
                            │
                            │ 1. Validate auth token
                            │ 2. Validate filename pair (xxx.py + xxx.html.j2)
                            │ 3. Write atomically to templates_userland/
                            │ 4. importlib.import_module / reload
                            │ 5. Validate exposed protocol
                            │ 6. Update TEMPLATE_HANDLERS registry
                            │ 7. Clear Jinja cache
                            │ 8. Insert audit row
                            ▼
              backend/data/templates_userland/  (persistent volume)
                  ├─ cs999.py
                  ├─ cs999.html.j2
                  └─ ...

         Subsequent /api/forms/{id}/download requests look up the
         template in the (now-extended) TEMPLATE_HANDLERS dict and
         render normally — no different from a built-in template.
```

---

## Versioning model

Each upload becomes a **new immutable version** of a template, never a replacement. At render time, the app picks the **highest-numbered version whose `VALID_FROM` ≤ `form.created`**. This preserves historical PDFs: a CS053 form filled in January 2026 always renders with the template that existed in January, even if a v2 lands in April.

- `form.created` is the date anchor — stable, set at form creation, doesn't drift when forms are edited
- Version numbers are **auto-assigned by the app**. The user uploads `cs053.py` + `cs053.html.j2` and the app slots it into the next available slot (v1 → v2 → v3…). The `.py` doesn't need a `VERSION` constant
- Built-in templates (CS037 / CS053 / CS208) are treated as **v1 with `VALID_FROM = epoch`** — they always cover the historical end. Uploads supersede them only for forms created after the upload's `VALID_FROM`
- Forms created **before** the earliest version's `VALID_FROM` render with the earliest available version + a logged warning (no hard failure)
- Disabling an uploaded version makes it skip the resolver — earlier versions take over (rollback path: "v2 was buggy, disable it, everything reverts to v1 until I upload v3")

### Storage layout

Each `form_code` gets a folder; each version gets a numbered subfolder:

```
backend/data/templates_userland/
  cs053/
    v2/
      cs053.py
      cs053.html.j2
      _meta.json    { valid_from, uploaded_at, python_sha256, template_sha256, disabled? }
    v3/
      cs053.py
      cs053.html.j2
      _meta.json
  cs999/
    v1/
      ...
```

The user uploads a flat pair (`cs053.py` + `cs053.html.j2`); the app handles slotting it into the right `vN` folder. Built-in templates live in `backend/app/reports/` as before — they don't appear in this volume.

## The upload contract

A user-supplied template is a pair: `{form_code}.py` + `{form_code}.html.j2`. Both files together. Naming convention: lower-case form code, no spaces.

The `.py` must export the following symbols. Anything missing → upload rejected with a clear error.

| Symbol | Type | Purpose |
|---|---|---|
| `DALUX_TEMPLATE_NAME` | `str` | Exact `template_name` string from `DLX_2_forms.template_name` — the join key |
| `FORM_CODE` | `str` | Short code shown in UI / used in filenames (e.g. `"CS999"`) |
| `FORM_DISPLAY` | `str` | Human-readable display name for the template dropdown |
| `VALID_FROM` | `str` | ISO date (e.g. `"2026-04-30"`) — earliest `form.created` this version applies to |
| `build_payload(db, form_id) -> dict` | function | Extracts data from MariaDB into a context dict |
| `render_html(payload) -> str` | function | Renders the Jinja template against the payload |
| `build_filename(db, form_meta) -> str` | function (optional) | Custom filename pattern |

The `.html.j2` is a regular Jinja2 template, accessed via `{form_code}.html.j2` in the loader. It can `{% include %}` the existing `_spencer_design_system.css.j2` partial (the loader path includes the built-in templates folder).

CS208 is the canonical example — its `.py` and `.html.j2` already match this protocol exactly, so it's the working reference for any new template.

### What uploaded code can use

- Any Python stdlib
- Any package already in [backend/requirements.txt](backend/requirements.txt) — currently: `fastapi`, `sqlalchemy`, `pymysql`, `jinja2`, `weasyprint`, `requests`, `pydantic`, `apscheduler`, `httpx`
- The `_spencer_design_system.css.j2` Jinja partial via `{% include %}`
- The same DB collation patterns used throughout (always `COLLATE utf8mb4_unicode_ci` on both sides of joins)

### What uploaded code cannot do

- Add new pip packages (would require Docker rebuild → IT signoff)
- Replace built-in templates (CS037/CS053/CS208) — those stay versioned in git
- Reach outside the volume / write to other host paths

---

## Security model

This feature is, by design, **remote code execution as a service.** Anyone who can hit the upload endpoint with a valid token can run any Python in the backend process. The mitigations are not optional:

1. **Token auth.** Every upload request must include `X-Admin-Token: <token>`. Token is set via `ADMIN_UPLOAD_TOKEN` env var on the server (IT chooses, communicates to Neil via secure channel). Backend rejects requests without a matching token.
2. **VPN-only network.** The app is reachable only from inside the Spencer VPN. Uploads from outside are not possible.
3. **Audit log.** Every upload attempt — successful or not — writes a row to SQLite (`template_uploads_audit`). IT can review at any time. Includes timestamp, file SHA-256, validation result, error message if any.
4. **Validation gate.** Bad code is rejected before being written to the volume:
    - Filename must match `[a-z0-9_]+\.(py|html\.j2)` and the pair must agree
    - Python file must import without exception
    - Module must declare all required symbols
    - `DALUX_TEMPLATE_NAME` must not collide with a built-in (CS037/CS053/CS208)
5. **No retroactive trust.** Even after a successful upload, if the handler crashes at render time, only that one form's download fails — the rest of the app keeps running. The crash is logged.

If any of these layers fails — token leaked, VPN compromised, validation bypassed — an attacker has full RCE. The mitigations are *defence in depth*; not a single one of them is "the secure layer".

---

## Components to build

### 1. Backend — dynamic template loader

**New module:** `backend/app/templates_userland/__init__.py` — module-level functions:
- `load_all()` — scan the volume folder, import every `.py` via `importlib.util.spec_from_file_location`, validate, register
- `load_one(form_code)` — import or `reload()` a single module
- `unregister(form_code)` — remove from `TEMPLATE_HANDLERS` (used on disable)
- `is_built_in(form_code)` — guard against overwriting CS037/CS053/CS208

**Volume path:** `backend/data/templates_userland/` (mounted in `docker-compose.yml`).

**Jinja loader extension** in `backend/app/reports/service.py` — currently each builder makes its own `Environment`. We add a shared module-level env that uses a **`ChoiceLoader`** with paths `[built-in templates, userland templates]`. Built-in modules continue using their own envs (no behaviour change); uploaded modules use the shared env.

**Registry hook:** at FastAPI startup, after `AppBase.metadata.create_all`, call `templates_userland.load_all()`. Failures during startup load are logged but don't kill the app — the offending template just isn't available.

### 2. Backend — upload endpoint

`POST /api/admin/templates/upload` (multipart form, `python_file` + `template_file` parts), header `X-Admin-Token`. Returns:

```json
{ "form_code": "CS999", "status": "registered", "handler": "Built-in CS999 — Pile Driving Inspection" }
```

On error:

```json
{ "status": "rejected", "reason": "missing required attribute DALUX_TEMPLATE_NAME" }
```

Atomic write: dump uploads to a `tmp_uploads/` dir, validate, then `os.rename()` into `templates_userland/`. If validation fails, temp files are deleted.

### 3. Backend — audit + listing

**Model** in [backend/app/models.py](backend/app/models.py):

```
template_uploads_audit
  id INTEGER PK
  uploaded_at DATETIME
  form_code TEXT
  version INTEGER NULL    -- assigned version if outcome=registered, null if rejected
  valid_from DATE NULL
  python_sha256 TEXT
  template_sha256 TEXT
  outcome TEXT             -- 'registered' | 'rejected' | 'disabled' | 'enabled' | 'deleted'
  error_message TEXT NULL
  uploader_ip TEXT NULL
```

**Endpoints:**
- `GET /api/admin/templates` — list every form_code with its versions (built-in + uploaded), sorted by version. Each entry: form_code, version, source (`builtin` | `uploaded`), valid_from, uploaded_at, disabled flag, display name
- `GET /api/admin/templates/audit?limit=100` — recent audit rows
- `POST /api/admin/templates/{form_code}/v{version}/disable` — mark disabled in `_meta.json` and unregister
- `POST /api/admin/templates/{form_code}/v{version}/enable` — re-enable
- `DELETE /api/admin/templates/{form_code}/v{version}` — remove the version folder (built-ins refused). Logs to audit.

### 4. Frontend — Admin Templates section

Extend [frontend/src/pages/AdminPage.tsx](frontend/src/pages/AdminPage.tsx) with a tabbed layout:

- **Tab 1: Projects** (existing — unchanged)
- **Tab 2: Templates** (new)

The Templates tab shows:

- Table of all templates: code, display name, source pill (built-in / uploaded), template_name, upload date, status (active / disabled), action (disable / enable / delete for uploaded only)
- Upload form: two file inputs, admin token field (or auto-loaded from a localStorage stash), submit button, server response panel
- Recent uploads log (last 20 audit rows)

### 5. Config

Add to [backend/app/config.py](backend/app/config.py) and `docker-compose.yml`:

- `ADMIN_UPLOAD_TOKEN` — secret string. If unset, the upload endpoint returns 503 (feature disabled).

Add to `.env.example` (so IT knows to set it).

---

## Built-in vs uploaded — the precedence rule

| Scenario | Behaviour |
|---|---|
| Uploaded `.py` declares `FORM_CODE` matching a built-in (CS053/CS037/CS208) | **Accepted as v2 of that form_code.** Used for `form.created ≥ VALID_FROM`; older forms keep using the built-in v1. |
| Uploaded `.py` declares `DALUX_TEMPLATE_NAME` not matching `FORM_CODE`'s built-in | **Rejected** — once a form_code is established, its DALUX_TEMPLATE_NAME is locked across versions. |
| Same `FORM_CODE` uploaded again | **Slots in as next version** (v3, v4, …). Each version is immutable. Audit log captures every upload. |
| `form.created` falls before earliest version's `VALID_FROM` | Render with earliest available version; log warning. |
| Uploaded handler crashes at render time | Only that form's download 500s. App continues. Crash logged. |
| Disabled uploaded version | Resolver skips it — next-lower version takes over. Rollback path. |
| Built-in templates (CS037/CS053/CS208) | Cannot be disabled or deleted — they're the historical-floor authority. Uploads add new versions on top. |

---

## Files to create / modify

| File | Change |
|---|---|
| `backend/app/templates_userland/__init__.py` | new — loader |
| `backend/app/templates_userland/admin.py` | new — upload + audit endpoints |
| `backend/data/templates_userland/.gitkeep` | new — placeholder so volume mount has the dir |
| [backend/app/models.py](backend/app/models.py) | add `TemplateUploadAudit` |
| [backend/app/main.py](backend/app/main.py) | wire loader into startup, mount admin endpoints |
| [backend/app/reports/service.py](backend/app/reports/service.py) | shared Jinja env with ChoiceLoader; expose registry mutation helpers |
| [backend/app/config.py](backend/app/config.py) | add `ADMIN_UPLOAD_TOKEN` |
| [backend/requirements.txt](backend/requirements.txt) | add `python-multipart` (FastAPI needs it for file uploads) |
| `docker-compose.yml` | add `templates_userland` volume + `ADMIN_UPLOAD_TOKEN` env passthrough |
| [docs/deployment_handoff.md](docs/deployment_handoff.md) | new section — set the token, document the volume |
| [frontend/src/pages/AdminPage.tsx](frontend/src/pages/AdminPage.tsx) | add Templates tab |
| [frontend/src/api.ts](frontend/src/api.ts) | new types + `uploadTemplate`, `fetchAdminTemplates`, `disableTemplate`, etc. |

---

## Smoke tests

1. **Fresh upload** — `cs999.py` + `cs999.html.j2` (minimal "Hello world", `VALID_FROM = "2026-04-30"`) with token → `200 registered as v1`. Listing shows it. Audit row written.
2. **Re-upload** same form_code → slots in as `v2`. v1 stays on disk + in registry.
3. **Bad upload** — `.py` missing `VALID_FROM` → `400 rejected`. No file written. Audit row with outcome `rejected`.
4. **Token mismatch** → `401`. No file written.
5. **DALUX_TEMPLATE_NAME mismatch on existing form_code** — try uploading another `cs999.py` with a different `DALUX_TEMPLATE_NAME` → `400 rejected: dalux_template_name locked once form_code is established`.
6. **Versioned upload over a built-in** — upload `cs053.py` v2 with `VALID_FROM = "2026-04-30"`. Forms with `created < 2026-04-30` still render with built-in v1. Forms with `created ≥ 2026-04-30` render with v2.
7. **Render fall-through** — form with no version qualifying its `created` date → renders with earliest, warning logged.
8. **Disable v2** → resolver skips it. Forms after the original cutover revert to v1.
9. **Enable v2** → comes back online.
10. **Built-in protected** — `DELETE /api/admin/templates/cs053/v1` → `400 rejected: built-in versions are immutable`.
11. **Restart backend** → uploaded versions re-registered from the volume on startup.
12. **Crash at render** — uploaded handler raises in `build_payload` → only that one form errors; other forms continue.

---

## Open questions / out of scope

- **Versioning of uploaded templates** — for MVP, latest wins. If you ever need to roll back, you'd re-upload the previous version. Could add explicit versioning later.
- **Per-template auth** — currently any valid admin token can upload anything. Could later add per-template ACLs if more than one person ever uploads.
- **Linting before upload** — we don't statically analyse the `.py` content beyond the protocol check. A future enhancement could run `ast.parse` + a security audit (e.g. forbid `subprocess`, `os.system`, network calls). Consciously deferred — Python is too dynamic to fully sandbox.
- **Diff view in audit log** — nice-to-have, lets you see what changed between two uploads of the same template. Out of MVP scope.
