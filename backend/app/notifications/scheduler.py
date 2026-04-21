"""APScheduler wiring — cron runs service.run_once() on schedule.

Cron: every day at :30 past the hour, 07:30-19:30 Europe/London.
Scheduler is started during FastAPI startup and shut down on shutdown.

Single-instance assumption: fine for the current single-container
docker-compose deploy. If we scale horizontally we'll need a distributed
lock (APScheduler supports this via a SQLAlchemy jobstore with a shared DB).
"""
from __future__ import annotations
import logging
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import settings
from app.database import SessionLocal, AppSessionLocal
from app.notifications.service import run_once

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None


def _job() -> None:
    """Scheduler-invoked job. Opens its own DB sessions so it isn't tied
    to a request lifecycle."""
    mdb = SessionLocal()
    adb = AppSessionLocal()
    try:
        result = run_once(mdb, adb)
        logger.info("notifications run complete: %s", result)
    except Exception as e:
        logger.exception("notifications run failed: %s", e)
    finally:
        mdb.close()
        adb.close()


def start() -> None:
    """Called from FastAPI startup. Safe to call when NOTIFY_ENABLED is
    false — scheduler still starts but the job early-returns."""
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="Europe/London")
    _scheduler.add_job(
        _job,
        trigger=CronTrigger(hour="7-19", minute=30, timezone="Europe/London"),
        id="notify_run_once",
        name="Teams notifications — closed forms ready for download",
        coalesce=True,     # collapse missed runs into one
        max_instances=1,   # no overlap
        misfire_grace_time=900,  # 15min grace if the job is late
    )
    _scheduler.start()
    logger.info("notification scheduler started (07:30-19:30 Europe/London, :30 past the hour)")


def shutdown() -> None:
    """Called from FastAPI shutdown."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("notification scheduler stopped")
