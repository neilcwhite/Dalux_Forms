# Docker Setup

> ℹ️ **This file is a shortcut.** The authoritative deployment guide lives at
> [`docs/deployment_handoff.md`](docs/deployment_handoff.md). It is kept up to date
> as features are added; this root-level pointer just makes it easy to find.

For deploying the app onto the on-prem Docker host, follow that document
end-to-end. It covers:

- Prerequisites (Docker, network reachability, outbound HTTPS)
- `.env` template with every required variable (use `backend/.env.example` as the starting point)
- `docker-compose build` / `up` sequence
- Mandatory bootstrap step for Teams notifications (avoids flooding the channel on first run)
- The template-upload feature's security model (read this before enabling)
- The email + password login layer (also read before deciding on `INITIAL_ADMIN_*` env vars)
- Verification + ongoing operations + backup priorities

For a one-page architecture & code-review brief written for a sceptical
senior reviewer, see [`docs/engineering_handoff.md`](docs/engineering_handoff.md).
