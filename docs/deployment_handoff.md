# Dalux Forms — Production Deployment Handoff

**Audience:** IT / DevOps (whoever manages the on-prem server that already hosts MariaDB and n8n).

**What's being deployed:** A FastAPI backend + a React frontend (served by nginx), both packaged as Docker containers via `docker-compose`. Connects to the existing MariaDB on the same host to read Dalux sync data. Generates PDF reports and posts Teams notifications via a Power Automate webhook.

**Repo:** `https://github.com/neilcwhite/Dalux_Forms.git`

**Originator:** Neil White (neil.white@thespencergroup.co.uk) — only contact him for the items in §"What you need from Neil" below; everything else is in this document.

---

## Before you start — secrets and choices checklist

Collect / decide these once, up front. Each maps to a `.env` variable in Step 2.

| Item | Source / how to get it |
|---|---|
| **DB_USER, DB_PASSWORD** for the SHEQ database | IT-managed. The app is **read-only** on MariaDB — needs `SELECT` on all `DLX_2_*` tables and `sheq_sites` in the `SHEQ` schema. Either **(a)** provision a new read-only user (recommended; suggested name: `dalux_forms_app`), or **(b)** reuse an existing reader account if you have one. Whatever account already runs the n8n Dalux sync has more privileges than this app needs. |
| **DALUX_API_KEY** | The same `X-API-KEY` value the existing n8n Dalux-sync workflow uses. Take it from your n8n credentials store; the app uses it identically — only to download photo attachments on demand. |
| **APP_PUBLIC_URL** | Your decision. Whatever URL Spencer staff will type into a browser to reach the app, e.g. `http://dalux-forms.cspencerltd.co.uk` (set up internal DNS) or `http://<server-ip>` (no DNS). It's embedded in the "Download PDF" buttons inside Teams notifications, so it must be reachable from a workstation on VPN. |
| **ADMIN_UPLOAD_TOKEN** | You generate it. Run `openssl rand -hex 32` (or equivalent) and store it in your normal secrets manager. Share with Neil so he can use the template-upload admin UI. |
| **NOTIFY_POWER_AUTOMATE_URL** | Neil sends this via the company password manager (it's the SAS-signed URL of an existing Power Automate flow he built). Alternatively, you can build your own flow — see §"What you need from Neil" → "Power Automate flow (alternative: build your own)" below. |

**That's the full list.** Everything else (`INITIAL_ADMIN_EMAILS`, `INITIAL_ADMIN_PASSWORD`, etc.) is pre-filled with sensible defaults below.

---

## What you need from Neil

Just one item — everything else above is yours to source:

1. **`NOTIFY_POWER_AUTOMATE_URL`** — the URL of the Power Automate flow that posts Teams notifications to the doc-control channel. He'll send this via the company password manager.

If you'd rather build your own flow (e.g. you want it owned by an IT service account rather than Neil's), the steps are at the end of this doc in §"Power Automate flow (alternative: build your own)". Either path works.

---

## What you need on the server

- Docker + docker-compose (already present — you use them for MariaDB / n8n)
- Network reachability to MariaDB on `DBHUB.cspencerltd.co.uk:3306` (trivial since it's on the same host)
- Outbound HTTPS to:
  - `https://node2.field.dalux.com` (Dalux API — photo downloads)
  - `https://*.api.powerplatform.com` (Power Automate webhook for Teams notifications — can be locked down to the specific subdomain in `NOTIFY_POWER_AUTOMATE_URL` once known)
- One TCP port chosen for the frontend (default 80 in `docker-compose.yml`; change the `ports:` mapping if 80 is taken)

---

## Step 1 — Clone the repository

Somewhere on the server (suggested: `/opt/dalux-forms/`):

```bash
git clone https://github.com/neilcwhite/Dalux_Forms.git /opt/dalux-forms
cd /opt/dalux-forms
```

---

## Step 2 — Create `.env` with production secrets

Copy the template and fill it in:

```bash
cp backend/.env.example backend/.env
chmod 600 backend/.env
```

Then edit `backend/.env`. Replace the four placeholders below with the values from your Before-you-start checklist; the rest is already correct:

```env
# MariaDB (read-only access — the app never writes here)
DB_HOST=DBHUB.cspencerltd.co.uk
DB_PORT=3306
DB_USER=<the read-only DB user you provisioned, e.g. dalux_forms_app>
DB_PASSWORD=<that user's password>
DB_NAME=SHEQ

# Dalux API — same X-API-KEY used by n8n
DALUX_API_KEY=<the existing Dalux API key>
DALUX_BASE_URL=https://node2.field.dalux.com/service/api

# App config
APP_NAME=Dalux Report Portal
DEBUG=false

# Teams notifications
NOTIFY_POWER_AUTOMATE_URL=<URL Neil sent you via password manager, OR your own flow URL — see §Power Automate alternative>
APP_PUBLIC_URL=<the URL Spencer staff will reach the app at, e.g. http://dalux-forms.cspencerltd.co.uk>
NOTIFY_ENABLED=false   # leave false until after Step 4 (bootstrap)

# Template upload feature (see Step 6 below for the security model)
ADMIN_UPLOAD_TOKEN=<the strong random string you generated with `openssl rand -hex 32`>

# Login allowlist — pre-filled. Both users seeded as admin on first startup
# with INITIAL_ADMIN_PASSWORD; they change it after first sign-in.
INITIAL_ADMIN_EMAILS=neil.white@thespencergroup.co.uk,claire.ransom@thespencergroup.co.uk
INITIAL_ADMIN_PASSWORD=Dalux
```

**Security recap:**
- `.env` is gitignored — never commit it. The `chmod 600` above keeps it readable only by the file owner.
- `NOTIFY_POWER_AUTOMATE_URL` contains a SAS signature; anyone with this URL can post to the Teams channel. Treat as a secret.
- `APP_PUBLIC_URL` must be reachable from Spencer-staff workstations on VPN, since it's the link target of "Download PDF" buttons in Teams messages.
- `ADMIN_UPLOAD_TOKEN` gates the template-upload endpoint. **Treat as an admin password.** See Step 6 for context. Rotate if leaked.

---

## Step 3 — Build and start the containers

```bash
cd /opt/dalux-forms
docker-compose build
docker-compose up -d
```

Check both containers are healthy:
```bash
docker-compose ps
```

Expect `dalux-backend` and `dalux-frontend` both `Up (healthy)`.

If the backend is unhealthy, check logs:
```bash
docker-compose logs backend
```

The frontend listens on port 80, backend on port 8000. Map to a different host port in `docker-compose.yml` if those are taken.

---

## Step 4 — ⚠️ MANDATORY: Run the bootstrap backfill

**Do this before enabling notifications, or the Teams channel will get flooded with ~30+ notifications for every currently-closed historical form.**

```bash
docker-compose exec backend python -m app.notifications.backfill
```

Expected output: `bootstrap complete: N rows inserted, 0 skipped as duplicates` where N is ~30–50.

This marks every currently-closed form as "already notified" so notifications only fire for forms that close **after** this moment.

---

## Step 5 — Enable notifications

Edit `backend/.env`:

```env
NOTIFY_ENABLED=true
```

Restart just the backend (keeps frontend up):

```bash
docker-compose restart backend
```

Confirm the scheduler started in the backend logs:

```bash
docker-compose logs backend | grep -i "scheduler"
```

Should see: `notification scheduler started (07:30-19:30 Europe/London, :30 past the hour)`.

---

## Step 6 — Template upload feature (read first, then verify)

This deployment includes a feature that lets Neil upload new form-report templates (a `.py` builder + `.html.j2` Jinja template pair) through a web admin page, **without you needing to redeploy the container.** This is intentional — it keeps you off the critical path for new form types.

**What you need to know:**

- The endpoint is `POST /api/admin/templates/upload`. It accepts arbitrary Python code that the backend then imports and runs to render reports. **This is, by design, remote code execution as a service** for whoever holds the `ADMIN_UPLOAD_TOKEN`. The mitigations are:
  1. **Token gate.** Without `ADMIN_UPLOAD_TOKEN` set, the endpoint returns 503 (disabled). With it set, only requests carrying `X-Admin-Token: <token>` are accepted — others get 401.
  2. **VPN-only network.** The app is only reachable from inside the Spencer VPN. External attackers cannot reach the endpoint.
  3. **Audit log.** Every upload — successful or not — writes a row to the `template_uploads_audit` SQLite table (timestamp, file SHA-256, IP, outcome, error if any). You can query this any time:
     ```bash
     docker-compose exec backend sqlite3 /app/backend/data/app.db \
       "SELECT uploaded_at, form_code, version, outcome, uploader_ip FROM template_uploads_audit ORDER BY uploaded_at DESC LIMIT 20"
     ```
  4. **Validation gate.** Uploads with malformed Python, missing required attributes, or attempts to override built-in templates are rejected before any file lands on disk.
  5. **Built-in templates locked.** The original CS037/CS053/CS208 templates ship inside the Docker image and **cannot be replaced or deleted via upload** — uploads can only add new versions on top of them, used for forms created after a `VALID_FROM` date the upload declares. Older forms always render with the built-in version.

- **Persistence:** uploaded templates live in `backend/data/templates_userland/` (already covered by the existing `./backend/data` volume mount — survives container restarts and `docker-compose down`).

- **Recommended:** generate a strong token now if you haven't already, and only share it with Neil via your normal secret channel:
  ```bash
  openssl rand -hex 32
  ```
  Put it in `backend/.env` as `ADMIN_UPLOAD_TOKEN=<...>` and restart:
  ```bash
  docker-compose restart backend
  ```

**If you'd rather not enable this feature for now**, leave `ADMIN_UPLOAD_TOKEN` unset. The endpoint will return 503 and Neil will need to come back to you for new templates the same way he did for the initial deployment.

**To rotate / revoke the token:** change the value in `.env`, restart the backend. Old token immediately invalid.

---

## Step 7 — Verify

1. **Frontend reachable:** `curl http://localhost:80` (from the server) — should return HTML
2. **Backend reachable:** `curl http://localhost:8000/` — should return `{"app":"Dalux Report Portal","status":"running",...}`
3. **MariaDB connected:** `curl http://localhost:8000/api/health/db` — should return table row counts
4. **Colleagues can access:** from a workstation on VPN, open `<APP_PUBLIC_URL>` in a browser

The scheduler will next fire at the upcoming :30 past the hour (if within 07:30–19:30 Europe/London window). With the bootstrap done, it'll find zero candidates until a new form closes in Dalux — that's expected.

---

## Ongoing operations

### View logs
```bash
docker-compose logs -f backend            # all backend logs
docker-compose logs -f backend | grep -i notification   # just notification events
```

### Manually trigger a notification run (for testing)
```bash
docker-compose exec backend python -m app.notifications.run_now
```

### Update to a new code version
```bash
cd /opt/dalux-forms
git pull
docker-compose build backend
docker-compose up -d
```
(No bootstrap needed on upgrades — only required once on fresh install.)

### Restart on server reboot

The containers have `restart: unless-stopped` policy already set in `docker-compose.yml` — they'll come back automatically when Docker starts.

---

## Persistent data

Three directories under `/opt/dalux-forms/backend/` persist between container restarts (mounted as Docker volumes):

| Path | Contains | Notes |
|---|---|---|
| `backend/data/app.db` | SQLite — downloads + notifications_sent + hidden_projects + template_uploads_audit | **Back up periodically** — losing this means re-running the notification bootstrap, plus losing the upload audit history |
| `backend/data/templates_userland/` | Uploaded report templates (per-form-code subfolders, one per version) | **Back up periodically** — these are the user's content, not in git. Losing this means re-uploading every custom template |
| `backend/photo_cache/` | Dalux photos cached locally | Safe to delete if space is tight; will re-download on demand |
| `backend/reports_cache/` | Generated PDFs cached by form ID + modified time | Safe to delete; will re-generate on demand |

---

## Troubleshooting — common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `dalux-backend` won't start; logs show "Can't connect to MySQL server" | DB credentials wrong, or the DB user lacks `SELECT` on the SHEQ tables | Verify the user from your secrets store can run `SELECT COUNT(*) FROM SHEQ.DLX_2_forms` from the host; check `.env` has no typos |
| `dalux-backend` healthcheck fails with no DB error | Missing `INITIAL_ADMIN_*` env vars; the bootstrap on first start can't seed users → app starts but login is broken | Check `docker-compose logs backend` for `[startup] bootstrapped N admin user(s)`; if N=0 on first start, set `INITIAL_ADMIN_EMAILS` and re-run after deleting `backend/data/app.db` |
| Backfill (Step 4) returns "0 rows inserted" | DB connection problem (the query itself returned no candidate forms because it can't reach MariaDB) — NOT an empty form set | Check DB credentials; manually run `docker-compose exec backend python -c "from app.database import SessionLocal; print(SessionLocal().execute(__import__('sqlalchemy').text('SELECT COUNT(*) FROM DLX_2_forms')).scalar())"` |
| Teams channel gets flooded right after `NOTIFY_ENABLED=true` | Step 4 (bootstrap) was skipped; the system thinks every closed form is "newly closed" | `docker-compose exec backend python -m app.notifications.backfill` and accept the flood, OR: set `NOTIFY_ENABLED=false`, run the backfill, then re-enable |
| After a week of forms closing in Dalux, no Teams notifications arrive | Three possible causes: (1) `NOTIFY_ENABLED=false`, (2) `NOTIFY_POWER_AUTOMATE_URL` is wrong/expired, (3) the Power Automate flow itself is failing | Check `docker-compose logs backend \| grep notification` for the scheduled run output; if the run shows `sent: 0`, check Power Automate flow's Run history at https://make.powerautomate.com |
| Template upload returns `503` | `ADMIN_UPLOAD_TOKEN` env var is unset, which disables the feature | Set the token in `.env` and `docker-compose restart backend` |
| Template upload returns `401 Invalid or missing X-Admin-Token` | The `X-Admin-Token` header sent doesn't match what's in `.env` | Confirm the value in your password manager matches `.env`; the user (Neil) needs the same string in their browser localStorage via the Admin → Templates tab token field |
| User can't log in even with correct password | Their account may have been disabled, or the bootstrap didn't seed them | Check `docker-compose exec backend sqlite3 /app/backend/data/app.db "SELECT email,active FROM approved_users"`; reactivate via Admin → Users tab if needed |

If you hit something not on this list, escalate to Neil with the relevant `docker-compose logs backend` excerpt.

---

## Auth (stop-gap before Azure Entra)

The app has a thin email + password login screen, intended as a placeholder until SSO is set up.

**What it is:**
- Each user has their own bcrypt-hashed password stored in SQLite (`approved_users` table inside `backend/data/app.db`).
- Two roles: `admin` (can manage other users) and `user` (read-only on the user list, full access to everything else).
- On first deployment, the app seeds the users listed in `INITIAL_ADMIN_EMAILS` as admins, all with the password set in `INITIAL_ADMIN_PASSWORD`. Each user changes their own password after first sign-in.
- After bootstrap, admins manage the user list from the Admin page → Users tab in the web UI. Initial password for new users is set by the admin and communicated to the user.

**What it isn't:**
- Real SSO. There is no MFA, no password complexity enforcement, no account lockout, no session-token signing. Backend endpoints are *not* gated — the actual security comes from VPN-only network access. This layer is named-user accountability + nice UX.

**To rotate / replace the bootstrap password:** change `INITIAL_ADMIN_PASSWORD` in `.env` and restart, then ask each bootstrap user to change their own password via the user menu in the top right.

**To remove a user's access:** Admin → Users tab → toggle to Disabled (preserves history) or Delete (permanent).

When Entra is set up, this whole layer gets swapped for OAuth — the user table becomes mostly redundant and the rest of the app stays put.

---

## Power Automate flow (alternative: build your own)

Skip this section if you're using the URL Neil sent you. If you'd rather own the flow under an IT service account — recommended for long-term operability so it doesn't disappear if Neil leaves — build it yourself in 5 minutes:

1. Go to **https://make.powerautomate.com** while signed in as the IT service account
2. **Create** → **Instant cloud flow** → **"When a HTTP request is received"** → name it e.g. `Dalux Forms — Closed form to Doc Control`
3. In the trigger: set **Who can trigger the flow?** → **"Anyone"** (the URL itself is the secret, signed with a SAS key)
4. Click **"Use sample payload to generate schema"** and paste:
   ```json
   {
     "form_code": "CS053",
     "form_id": "S436856085521893376",
     "template_name": "Weekly Safety inspection",
     "template_display_name": "CS053 — Weekly Safety inspection",
     "site_name": "Kessock Bridge Tower Rescue System",
     "sos_number": "C2130",
     "form_number": "PaintInspection_1",
     "modified_at": "2026-04-19T14:22:00Z",
     "download_url": "https://forms.spencergroup.internal/api/forms/S436856085521893376/download"
   }
   ```
5. **+ New step** → search **"Post adaptive card in a chat or channel"** → choose **Microsoft Teams** → set Post-as: **Flow bot**, Post-in: **Channel**, then pick the doc-control channel
6. In the **Adaptive Card** field, paste:
   ```json
   {
     "type": "AdaptiveCard",
     "version": "1.4",
     "body": [
       {
         "type": "Container",
         "style": "accent",
         "items": [
           { "type": "TextBlock", "text": "@{triggerBody()?['form_code']} closed - ready for QA",
             "weight": "Bolder", "size": "Large", "wrap": true },
           { "type": "TextBlock", "text": "@{triggerBody()?['template_display_name']}",
             "isSubtle": true, "spacing": "None", "wrap": true }
         ]
       },
       {
         "type": "FactSet",
         "facts": [
           { "title": "Site",     "value": "@{triggerBody()?['site_name']}" },
           { "title": "SOS #",    "value": "@{triggerBody()?['sos_number']}" },
           { "title": "Form No.", "value": "@{triggerBody()?['form_number']}" },
           { "title": "Form ID",  "value": "@{triggerBody()?['form_id']}" },
           { "title": "Modified", "value": "@{triggerBody()?['modified_at']}" }
         ]
       },
       { "type": "TextBlock", "text": "Form is closed in Dalux and ready to download.",
         "wrap": true, "spacing": "Medium" }
     ],
     "actions": [
       { "type": "Action.OpenUrl", "title": "Download PDF",
         "url": "@{triggerBody()?['download_url']}", "style": "positive" }
     ]
   }
   ```
7. **Save**. Go back to the trigger step — the **HTTP POST URL** field now has a long URL ending in `sig=...`. Copy it and put it in `.env` as `NOTIFY_POWER_AUTOMATE_URL`.

To verify before letting the app fire it, run from the host (replacing the URL with yours):
```bash
curl -X POST "https://default.../sig=..." \
  -H "Content-Type: application/json" \
  -d '{"form_code":"CS053","form_id":"TEST-001","template_name":"Weekly Safety inspection","template_display_name":"CS053 - Smoke Test","site_name":"TEST","sos_number":"C0000","form_number":"TEST-001","modified_at":"2026-01-01T00:00:00Z","download_url":"https://example.com"}'
```

A 202 means accepted — a test card should appear in the channel within 10 seconds.

---

## Reference

- Teams notifications design and rationale: [docs/teams_notifications_plan.md](teams_notifications_plan.md)
- Template upload design and security model: [docs/template_upload_plan.md](template_upload_plan.md)
- Engineering review brief: [docs/engineering_handoff.md](engineering_handoff.md)
