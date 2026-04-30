# Dalux Forms — Production Deployment Handoff

**Audience:** IT / DevOps (whoever manages the on-prem server that already hosts MariaDB and n8n).

**What's being deployed:** A FastAPI backend + a React frontend (served by nginx), both packaged as Docker containers via `docker-compose`. Connects to the existing MariaDB on the same host to read Dalux sync data. Generates PDF reports and posts Teams notifications via a Power Automate webhook.

**Who asked for this:** Neil White (neil.white@thespencergroup.co.uk).

---

## What you need

- Docker + docker-compose on the server (already present — you use it for MariaDB / n8n)
- Network reachability to the existing MariaDB instance on `DBHUB.cspencerltd.co.uk:3306` (should be trivial since it's on the same host)
- Outbound HTTPS to:
  - `https://node2.field.dalux.com` (Dalux API — photo downloads)
  - `https://default1cba2c5f4b4449ffbc9a4b83f5d6e6.bb.environment.api.powerplatform.com` (Power Automate webhook for Teams)
- A published internal URL for colleagues to reach the frontend, e.g. `http://dalux-forms.cspencerltd.co.uk` or `http://<server-ip>:80`

---

## Step 1 — Clone the repository

Somewhere on the server (e.g. `/opt/dalux-forms/`):

```bash
git clone https://github.com/<org>/Dalux_Forms.git /opt/dalux-forms
cd /opt/dalux-forms
```

*(Ask Neil for the correct repo URL if unclear.)*

---

## Step 2 — Create `.env` with production secrets

Create `/opt/dalux-forms/backend/.env` (Neil will provide the exact values):

```env
# MariaDB (same host — can use 127.0.0.1 or container network if MariaDB is also in Docker)
DB_HOST=DBHUB.cspencerltd.co.uk
DB_PORT=3306
DB_USER=<mariadb-user>
DB_PASSWORD=<mariadb-password>
DB_NAME=SHEQ

# Dalux API
DALUX_API_KEY=<dalux-api-key>
DALUX_BASE_URL=https://node2.field.dalux.com/service/api

# App config
APP_NAME=Dalux Report Portal
DEBUG=false

# Teams notifications
NOTIFY_POWER_AUTOMATE_URL=<full Power Automate URL — Neil has this; it contains a sig= signature, treat as a secret>
APP_PUBLIC_URL=http://<the URL colleagues will use, e.g. http://dalux-forms.cspencerltd.co.uk>
NOTIFY_ENABLED=false

# Template upload feature (see "Step 6" below)
ADMIN_UPLOAD_TOKEN=<a strong random string, e.g. `openssl rand -hex 32` — share with Neil only>
```

**Security notes:**
- `.env` is gitignored — never commit it
- `NOTIFY_POWER_AUTOMATE_URL` contains a SAS signature; anyone with this URL can post to the Teams channel. Restrict file permissions: `chmod 600 backend/.env`
- `APP_PUBLIC_URL` must be the URL colleagues reach the app at — it's embedded in the "Download PDF" buttons in Teams messages
- `ADMIN_UPLOAD_TOKEN` gates the template-upload endpoint. **Treat this like an admin password.** See Step 6 below for full context — this feature lets Neil ship new form-report templates without you needing to redeploy. Rotate the token if it's ever shared inappropriately

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

## What to escalate back to Neil

- Container won't start / can't reach MariaDB
- Backfill returns 0 rows inserted (implies DB connection problem, not an empty set)
- Teams messages flooding after enable (should not happen if backfill was run — means it was skipped)
- After a week, no notifications received when forms are closing in Dalux

---

## Reference

- Teams notifications design and rationale: [docs/teams_notifications_plan.md](teams_notifications_plan.md)
- Template upload design and security model: [docs/template_upload_plan.md](template_upload_plan.md)
