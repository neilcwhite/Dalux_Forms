# Docker Setup & Deployment Guide

## Overview

The Dalux Report Portal is now packaged as Docker containers for easy distribution to colleagues. The setup includes:

- **Backend**: Python 3.14 FastAPI application with WeasyPrint PDF generation
- **Frontend**: React UI served via nginx with reverse proxy to backend API
- **Database**: Connects to existing on-premise MariaDB over VPN
- **Volumes**: Persistent storage for photo cache, report cache, and SQLite app database

## Prerequisites

Your colleague workstation needs:

1. **Docker Desktop** (Windows/Mac) or **Docker + Docker Compose** (Linux)
   - [Download Docker Desktop](https://www.docker.com/products/docker-desktop)
   - Version: Docker 20.10+ and Docker Compose 2.0+

2. **VPN Connection** (required)
   - Must be connected to Spencer Group VPN to reach DBHUB.cspencerltd.co.uk

3. **Network Access**
   - Ports 80 (frontend) and 8000 (backend API) must be available on localhost

## Quick Start (3 Steps)

### Step 1: Configure Environment

Copy `.env.example` to `.env.local` in the project root:

```bash
cd C:\GitHub\Dalux_Forms
copy backend\.env.example .env.local
```

Edit `.env.local` and fill in credentials:

```env
DB_HOST=DBHUB.cspencerltd.co.uk
DB_PORT=3306
DB_USER=your_mariadb_user
DB_PASSWORD=your_mariadb_password
DB_NAME=SHEQ
DALUX_API_KEY=your_dalux_api_key
DALUX_BASE_URL=https://node2.field.dalux.com/service/api
APP_NAME=Dalux Report Portal
DEBUG=false
```

### Step 2: Start Containers

```bash
docker-compose up -d
```

Wait ~10 seconds for containers to start. Check status:

```bash
docker-compose ps
```

Expected output:
```
NAME                COMMAND                 STATUS
dalux-backend      "uvicorn app.main:..."  Up (healthy)
dalux-frontend     "nginx -g daemon off"   Up
```

### Step 3: Access the Application

Open browser and navigate to:

```
http://localhost
```

If you see the Forms page, you're ready to use it!

## Troubleshooting

### Backend won't start: "ModuleNotFoundError: No module named 'weasyprint'"

**Cause**: GTK3 libraries not installed (WeasyPrint system dependency).

**Solution**:
```bash
docker-compose down
docker-compose build --no-cache backend
docker-compose up -d
```

### "Cannot connect to MariaDB" error

**Cause**: VPN not connected or credentials wrong.

**Checks**:
1. Verify VPN is connected (`ipconfig | find "PPP"` on Windows)
2. Test MariaDB connection:
   ```bash
   docker-compose exec backend python -c "from app.config import settings; import pymysql; pymysql.connect(host=settings.DB_HOST, user=settings.DB_USER, password=settings.DB_PASSWORD)"
   ```
3. Verify credentials in `.env.local` match your MariaDB account

### "Address already in use" error

**Cause**: Port 80 or 8000 already in use.

**Solution**: Either stop conflicting service or map to different port in docker-compose.yml:
```yaml
services:
  frontend:
    ports:
      - "8080:80"  # Access on http://localhost:8080
```

### Frontend shows "Cannot connect to API"

**Cause**: Backend container hasn't started yet or is unhealthy.

**Solution**:
```bash
docker-compose logs backend
docker-compose exec backend curl http://localhost:8000/
```

## Daily Usage

### Start application:
```bash
docker-compose up -d
```

### Stop application:
```bash
docker-compose down
```

### View logs:
```bash
# All containers
docker-compose logs -f

# Just backend
docker-compose logs -f backend

# Just frontend
docker-compose logs -f frontend
```

### Access backend shell:
```bash
docker-compose exec backend bash
```

### Rebuild after code changes:
```bash
docker-compose down
docker-compose build
docker-compose up -d
```

## Volumes & Persistent Data

Three volumes are automatically created and persist data between restarts:

- **backend/data/app.db** — SQLite database tracking downloads (created on first run)
- **backend/photo_cache/** — Downloaded Dalux photos (cached for performance)
- **backend/reports_cache/** — Generated PDFs (cached by form ID + modified timestamp)

These directories are created automatically inside the containers. To clean them:

```bash
docker-compose down -v
docker-compose up -d
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DB_HOST | ✓ | DBHUB.cspencerltd.co.uk | MariaDB hostname |
| DB_PORT | | 3306 | MariaDB port |
| DB_USER | ✓ | | MariaDB username |
| DB_PASSWORD | ✓ | | MariaDB password |
| DB_NAME | | SHEQ | Database name |
| DALUX_API_KEY | ✓ | | Dalux API authentication key |
| DALUX_BASE_URL | | https://node2.field.dalux.com/service/api | Dalux API endpoint |
| APP_NAME | | Dalux Report Portal | Application title |
| DEBUG | | false | Enable debug logging (true/false) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Colleague Workstation              │
├─────────────────────────────────────────────────────┤
│  Browser: http://localhost (port 80)                │
│    │                                                │
│    ├─→ [nginx Container]                           │
│    │    ├─ Serves React static assets              │
│    │    └─ Proxies /api/ → backend:8000            │
│    │                                                │
│    └─→ [Backend Container] (port 8000 internal)    │
│         ├─ FastAPI application                     │
│         ├─ Caches: photo_cache/, reports_cache/   │
│         ├─ Database: SQLite app.db                 │
│         └─ Connects to: DBHUB.cspencerltd.co.uk    │
│              (over VPN)                             │
└─────────────────────────────────────────────────────┘
```

## Network Details

- **Backend listens**: 0.0.0.0:8000 (inside container)
- **Frontend (nginx) listens**: 0.0.0.0:80 (inside container)
- **Host ports exposed**: 80 (frontend) and 8000 (backend debug API)
- **Container communication**: Via Docker bridge network `dalux-network`

Colleagues can safely ignore the backend port; they only access the frontend on port 80.

## Support & Debugging

### Check container health:
```bash
docker-compose ps
docker stats
```

### Inspect running processes:
```bash
docker-compose top backend
docker-compose top frontend
```

### Force rebuild (if image caching causes issues):
```bash
docker-compose build --no-cache
```

### Remove all containers and images (fresh start):
```bash
docker-compose down -v
docker system prune -a
docker-compose up -d
```

## Security Notes

1. **.env.local is gitignored** — Each colleague should have their own copy with their credentials
2. **No authentication** — This is a local/team tool. Production should add SSO via Azure Entra (documented in audit_limitations.md)
3. **VPN required** — MariaDB connection is not accessible without VPN
4. **DEBUG mode** — Set to false in .env.local for production use (reduces logging verbosity)

## Next Steps

1. Share this repository with colleagues
2. Have them copy `.env.example` → `.env.local` and fill in their DB credentials
3. Run `docker-compose up -d` and access on http://localhost
4. Test by navigating to a site and downloading a PDF

---

**Questions?** Check `docs/DALUX_PROJECT_SCOPE_v3.2.md` for technical architecture details.
