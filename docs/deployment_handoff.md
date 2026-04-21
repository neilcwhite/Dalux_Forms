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
```

**Security notes:**
- `.env` is gitignored — never commit it
- `NOTIFY_POWER_AUTOMATE_URL` contains a SAS signature; anyone with this URL can post to the Teams channel. Restrict file permissions: `chmod 600 backend/.env`
- `APP_PUBLIC_URL` must be the URL colleagues reach the app at — it's embedded in the "Download PDF" buttons in Teams messages

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

## Step 6 — Verify

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
| `backend/data/app.db` | SQLite — download audit log + notifications_sent table | **Back up periodically** — losing this means re-running the bootstrap, which creates a brief risk window |
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

Design and rationale: [docs/teams_notifications_plan.md](teams_notifications_plan.md) in the same repo.
