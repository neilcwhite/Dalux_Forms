# Teams Notifications for Closed, Ready-to-Download Forms

## Status log

| Date | Milestone | Status |
|---|---|---|
| 2026-04-21 | Architecture agreed, plan written | ✅ Done |
| 2026-04-21 | `NotificationSent` model added to `models.py`; SQLite schema auto-created on startup | ✅ Done |
| 2026-04-21 | `notifications/service.py` — candidate query + dedup + Power Automate POST | ✅ Done |
| 2026-04-21 | `notifications/scheduler.py` — APScheduler cron at :30 past the hour 07:30–19:30 Europe/London | ✅ Done |
| 2026-04-21 | `notifications/backfill.py` + `notifications/run_now.py` CLIs | ✅ Done |
| 2026-04-21 | Config vars wired (`NOTIFY_POWER_AUTOMATE_URL`, `APP_PUBLIC_URL`, `NOTIFY_ENABLED`); docker-compose updated | ✅ Done |
| 2026-04-21 | Scheduler wired into FastAPI lifespan (`main.py`) | ✅ Done |
| 2026-04-21 | `apscheduler==3.10.4` added to requirements and installed | ✅ Done |
| 2026-04-21 | Smoke test: 32 live candidates detected; next scheduled run 08:30 BST; `NOTIFY_ENABLED=false` short-circuits correctly | ✅ Done |
| 2026-04-21 | Power Automate flow created (workflow id `235d34887424418c...`); test card landed in doc-control channel | ✅ Done |
| 2026-04-21 | Dev bootstrap run: 32 existing closed forms marked `bootstrap`; dedup confirmed (post-bootstrap candidates = 0) | ✅ Done |
| 2026-04-21 | Dev `NOTIFY_ENABLED=true` | ✅ Done |
| — | **Prod deploy**: set `NOTIFY_POWER_AUTOMATE_URL`, `APP_PUBLIC_URL=<real https URL>`, leave `NOTIFY_ENABLED=false` initially | ⬜ Not started |
| — | **Prod bootstrap**: run `python -m app.notifications.backfill` on prod container BEFORE enabling | ⬜ Not started |
| — | Prod `NOTIFY_ENABLED=true` + restart | ⬜ Not started |
| — | Observe first real notification fire (wait for a form to close + next :30 run) | ⬜ Not started |

_Claude: update this table as work lands — mark status, add date, note surprises or deviations from the plan below._

---

## Context

Doc control has no proactive signal that a form has been closed in Dalux and is ready to QA/archive. Today they'd have to log into the app and scan. We want a Teams notification with a direct download link so they can grab the PDF the moment it's ready.

Scope is any template with a custom-report builder. Today that's CS037/CS053/CS208. The `TEMPLATES_WITH_CUSTOM_REPORT` registry in [backend/app/main.py:30-43](backend/app/main.py#L30-L43) is the source of truth — when future templates are added there, they auto-enrol in notifications. Originators don't get notified; only the doc-control channel.

Dedup rule (user-chosen): **notify when a form is closed AND has been modified since the last download**. Forms modified after download re-notify; untouched closed forms don't get re-pinged.

---

## Sync cadence (operational facts, drives scheduler timing)

- n8n runs two Dalux sync queries per hour: at **:00** and **:10**
- Most syncs finish within **2–3 minutes**
- Business expects notifications only during **07:00–19:00** (UK local). Anything that closes after 19:00 is fine to wait for 07:30 next morning.

This means we don't need n8n to trigger us — a cron offset of **:30 past the hour** gives a comfortable ~20-minute buffer after the :10 sync ends, and our detection stays pure app-side.

---

## Recommended Architecture — App-side scheduler, Power Automate delivery

```
                           Europe/London cron
                           07:30, 08:30, ..., 19:30
                                 │
                                 ▼
      FastAPI APScheduler job ────────────────┐
                                              │
   1. Query DLX_2_forms for candidates        │
   2. Apply "closed + modified since download"│
      dedup against SQLite downloads +        │
      notifications_sent                       │
   3. For each candidate: POST JSON body to   │
      Power Automate HTTP trigger URL         │
   4. Log result (sent / failed) to           │
      notifications_sent                       │
                                              │
                                              ▼
                          Power Automate HTTP-triggered flow
                                              │
                                              ▼
                                 Teams "#doc-control" channel
                                 (Adaptive Card with "Download PDF" button)
```

### Why this split

| Responsibility | Home | Why here |
|---|---|---|
| **Scheduling** | FastAPI APScheduler | Hourly sync + fixed 2-3 min finish time makes a cron at :30 reliable — no need to couple to n8n. Working-hours window (07:30–19:30) is a simple `hour="7-19"` cron expression |
| **Detection + dedup** | FastAPI | Needs SQLite `downloads` (dedup), MariaDB `DLX_2_forms`, and the `TEMPLATES_WITH_CUSTOM_REPORT` registry — all already here |
| **Teams delivery** | Power Automate | First-party Microsoft product, not the deprecated Incoming Webhook / Connector. Supports Adaptive Cards. Routing / recipients / card layout editable in UI without redeploying the app. 5-year-horizon safe |

### Why not n8n-triggered

Tempting to have n8n POST to FastAPI when sync finishes — but with hourly sync and predictable finish times, a fixed cron at :30 past the hour is just as reliable and has far fewer moving parts (no n8n workflow to maintain, no shared secret between n8n and FastAPI). If sync behaviour ever changes (e.g. becomes event-driven) we can switch to a trigger endpoint later without schema changes.

### Why not legacy Incoming Webhook

Microsoft announced retirement of Teams Incoming Webhooks / Office 365 Connectors (July 2024). Power Automate HTTP triggers are the first-party replacement — different mechanism, same ease of use, long-term supported.

### Why not Graph API direct

Viable (Graph is Microsoft's most stable long-term API), but requires an Azure app registration with admin consent and `ChannelMessage.Send.Group` scope. Adds OAuth machinery to FastAPI and rotation hygiene on secrets. Power Automate avoids all of that and keeps recipient routing in the hands of the doc-control team. Revisit Graph if Power Automate licensing ever becomes a constraint.

---

## Components to build

### 1. FastAPI — notification service

**New module** `backend/app/notifications/`:
- `service.py` — candidate query, dedup filter, Power Automate POST, recording
- `scheduler.py` — APScheduler setup, wired into FastAPI lifespan
- `schemas.py` — Pydantic body for the outbound POST
- `backfill.py` — one-shot bootstrap CLI (see below)

**Model** (appended to [backend/app/models.py](backend/app/models.py) alongside existing `Download`):
```
notifications_sent
  id               INTEGER PK
  form_id          TEXT
  form_modified_at DATETIME    -- snapshot of DLX_2_forms.modified at notify time
  sent_at          DATETIME
  status           TEXT         -- 'sent' | 'failed' | 'bootstrap'
  template_name    TEXT
  UNIQUE(form_id, form_modified_at)
```
Dedup key `(form_id, form_modified_at)`: a re-modified form has a new `modified` value, which re-opens the notification window, matching the selected dedup rule.

**Candidate query** (pattern already used in [backend/app/main.py site_form_summary](backend/app/main.py#L60) and [backend/app/reports/service.py:50-67](backend/app/reports/service.py#L50-L67)):
```sql
SELECT f.formId, f.template_name, f.modified, f.number, f.status,
       COALESCE(s.site_name, p.projectName) AS site_name,
       s.sos_number
FROM DLX_2_forms f
LEFT JOIN DLX_2_projects p
  ON f.projectId COLLATE utf8mb4_unicode_ci = p.projectId COLLATE utf8mb4_unicode_ci
LEFT JOIN sheq_sites   s
  ON f.projectId COLLATE utf8mb4_unicode_ci = s.dalux_id COLLATE utf8mb4_unicode_ci
WHERE f.status = 'closed'
  AND f.template_name IN (:custom_report_templates)
  AND (f.deleted = 0 OR f.deleted IS NULL)
```

**Filter pipeline** (in Python, on the candidate set):
1. Look up latest `downloads.downloaded_at` for each form_id
2. Keep if `form.modified > latest_download` OR never downloaded
3. Drop if `(form_id, form.modified)` already in `notifications_sent`
4. POST card body → record result

**Reuse — don't duplicate:**
- `TEMPLATES_WITH_CUSTOM_REPORT` in [backend/app/main.py:30-43](backend/app/main.py#L30-L43) — drives `template_name IN (...)` filter and the `form_code` in the card
- `Download` model in [backend/app/models.py:7-24](backend/app/models.py#L7-L24) — for the "since last download" check
- Site/SOS join pattern already in [backend/app/main.py list_sites](backend/app/main.py#L125) and [backend/app/reports/service.py:50-67](backend/app/reports/service.py#L50-L67)

### 2. Scheduler

`APScheduler` (`AsyncIOScheduler`) wired into FastAPI lifespan ([backend/app/main.py](backend/app/main.py) startup/shutdown). Cron trigger:
```python
CronTrigger(hour="7-19", minute=30, timezone="Europe/London")
```
Runs 13× per day (07:30 → 19:30 inclusive). The `zoneinfo` dep and Europe/London handling are already used in [backend/app/reports/cs053.py:141-149](backend/app/reports/cs053.py#L141-L149).

Single-instance caveat: if we ever scale to multiple backend containers, the scheduler would fire N times per run. Not an issue today (single-container docker-compose). Mitigate later with either a separate "scheduler" container or APScheduler's distributed lock support.

### 3. Config additions

[backend/app/config.py](backend/app/config.py) + [docker-compose.yml](docker-compose.yml):
- `NOTIFY_POWER_AUTOMATE_URL` — the flow's HTTP trigger URL
- `APP_PUBLIC_URL` — base for building download links (e.g. `https://forms.spencergroup.internal`). Doesn't exist today; needed for the "Download PDF" button
- `NOTIFY_ENABLED` — boolean kill-switch (default true in prod, false in dev)

### 4. Power Automate flow (external, set up once)

Visual flow in Power Automate portal:
- **Trigger**: "When a HTTP request is received" (generates the URL + SAS token we'll configure as `NOTIFY_POWER_AUTOMATE_URL`)
- **JSON schema**: the body we POST
- **Action**: "Post adaptive card in a chat or channel" → doc-control channel, render card with:
  - Header: `{form_code} closed — {site_name}`
  - Facts: Site / SOS# / Form No. / Closed date / Modified date
  - Action: "Download PDF" → `{download_url}`
- **Response**: 200 to FastAPI

**POST body shape** (one request per form):
```json
{
  "form_code": "CS053",
  "form_id": "S436856085521893376",
  "template_display_name": "Weekly Safety inspection",
  "site_name": "Kessock Bridge Tower Rescue System",
  "sos_number": "C2130",
  "form_number": "PaintInspection_1",
  "modified_at": "2026-04-19T14:22:00Z",
  "download_url": "https://forms.spencergroup.internal/api/forms/S436856085521893376/download"
}
```

---

## Bootstrapping (mandatory on first deploy)

Hundreds of already-closed, never-downloaded forms are sitting in the DB. Enabling the scheduler naively would flood the channel.

**Mitigation** — `backfill.py` CLI run once, before enabling the cron:
```
python -m app.notifications.backfill
```
Inserts `(form_id, form.modified, 'bootstrap')` rows into `notifications_sent` for every currently-closed form across all registered templates. Only changes after deploy will notify.

Re-runnable and idempotent (UNIQUE on `(form_id, form_modified_at)` makes inserts harmless on repeat).

---

## Critical files to modify / create

| File | Change |
|---|---|
| `backend/app/notifications/__init__.py` | new |
| `backend/app/notifications/service.py` | new — query + dedup + dispatch |
| `backend/app/notifications/scheduler.py` | new — APScheduler setup |
| `backend/app/notifications/schemas.py` | new — POST body |
| `backend/app/notifications/backfill.py` | new — bootstrap CLI |
| [backend/app/models.py](backend/app/models.py) | add `NotificationSent` model |
| [backend/app/main.py](backend/app/main.py) | wire scheduler into lifespan |
| [backend/app/config.py](backend/app/config.py) | add `NOTIFY_POWER_AUTOMATE_URL`, `APP_PUBLIC_URL`, `NOTIFY_ENABLED` |
| [backend/requirements.txt](backend/requirements.txt) | add `apscheduler` |
| [docker-compose.yml](docker-compose.yml) | pass new env vars through |
| Power Automate flow | create in portal (out of repo — needs runbook docs) |

---

## Pros & cons of the recommended approach

**Pros**
- Entirely in-repo code (plus one Power Automate flow) — no n8n workflow tangle to maintain
- Scheduler timing aligns precisely with the hourly sync rhythm; working-hours window baked in via cron
- Dedup reuses existing `downloads` table — no data duplication
- Power Automate is Microsoft-supported, 5-year-horizon safe, and doc control can re-route the channel without code deploy
- Future templates auto-enrol via the existing registry
- First-run flood guarded by bootstrap backfill

**Cons**
- APScheduler in-process means the scheduler dies if the FastAPI container dies — OK for MVP, but on a future multi-container setup we'd need either a dedicated scheduler container or a distributed lock
- Shared Europe/London timezone hard-coded in the cron; multi-tenant / cross-region later would need config
- Power Automate flow is out-of-repo — needs its own runbook (URL, recipients, card layout) so it's not a bus-factor-1 artefact
- First-run requires bootstrap; forgetting it on deploy = flood. Deploy checklist must call it out
- No retry queue; a Power Automate 5xx means the notification is logged `failed` and not retried. Acceptable for MVP (next run's candidates set will re-include it because `notifications_sent.status='failed'` can be treated as "not yet sent"). Revisit if Power Automate proves flaky

---

## Verification (when it's actually built)

1. **Unit** — dedup function correctly filters: (a) never-downloaded closed form → sent; (b) closed form modified after last download → sent; (c) already in `notifications_sent` with matching `form_modified_at` → skipped; (d) closed but not modified since download → skipped
2. **Integration** (local) — hit the scheduler job manually with a test form → see JSON body arrive at a test Power Automate flow → see card land in a test Teams channel
3. **End-to-end** (staging) — wait for a real :30 run → observe Teams card with working Download button → confirm `notifications_sent` row recorded
4. **Idempotency** — run the job back-to-back → second run sends zero messages
5. **Revision re-notify** — download a form → edit it in Dalux → wait for next sync + scheduler run → confirm re-notification with updated `modified_at`
6. **Working-hours window** — confirm scheduler doesn't fire at 20:30, 06:30, etc.
7. **Bootstrap** — on a fresh staging DB, run backfill → run scheduler once → zero messages sent

---

## Open questions for next session (not blocking this plan)

- `APP_PUBLIC_URL` — what's the actual prod URL? Do Teams users on the doc-control team have network reachability to it from their browsers?
- Authentication on `/api/forms/{id}/download` — currently public; if that changes before this ships, Teams links need session/token support
- Weekend handling — scheduler runs every day by default. Do we want weekdays only? (construction works weekends, so probably not, but worth confirming)
- Power Automate licensing — any tenant-level restrictions on HTTP-triggered flows? Worth a 5-minute check with IT before building
- Grouping — if 8 forms close in one hour, do we want 8 separate cards or one card listing all 8? MVP = one per form (simpler dedup + per-form action buttons); revisit if it gets noisy
