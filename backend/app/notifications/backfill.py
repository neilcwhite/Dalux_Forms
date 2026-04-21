"""One-shot bootstrap CLI.

Run once before enabling the scheduler on a fresh deploy:

    cd backend
    ./venv/Scripts/python.exe -m app.notifications.backfill

Marks every currently-closed custom-report form as 'bootstrap' in
notifications_sent, so only changes after deploy will trigger notifications.

Idempotent — re-running is safe (UNIQUE on (form_id, form_modified_at) drops
duplicates).
"""
from __future__ import annotations
import logging

from app.database import SessionLocal, AppSessionLocal, app_engine, AppBase
from app.models import NotificationSent
from app.notifications.service import find_candidates

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    # Ensure tables exist (running this standalone shouldn't require a
    # prior uvicorn startup to have created the schema).
    AppBase.metadata.create_all(bind=app_engine)

    mdb = SessionLocal()
    adb = AppSessionLocal()
    try:
        candidates = find_candidates(mdb, adb)
        logger.info("found %d closed forms not yet notified", len(candidates))

        inserted = 0
        for c in candidates:
            row = NotificationSent(
                form_id=c.form_id,
                form_modified_at=c.modified,
                status="bootstrap",
                template_name=c.template_name,
                http_status=None,
                error_message=None,
            )
            try:
                adb.add(row)
                adb.commit()
                inserted += 1
            except Exception as e:
                adb.rollback()
                logger.debug("skip %s (likely duplicate): %s", c.form_id, e)

        logger.info("bootstrap complete: %d rows inserted, %d skipped as duplicates",
                    inserted, len(candidates) - inserted)
    finally:
        mdb.close()
        adb.close()


if __name__ == "__main__":
    main()
