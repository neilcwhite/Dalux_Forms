"""Manual trigger — runs one notification pass immediately.

    cd backend
    ./venv/Scripts/python.exe -m app.notifications.run_now

Useful for testing end-to-end without waiting for the 07:30-19:30 cron.
Honours NOTIFY_ENABLED just like the scheduled job.
"""
from __future__ import annotations
import json
import logging

from app.database import SessionLocal, AppSessionLocal, app_engine, AppBase
from app.notifications.service import run_once

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main() -> None:
    AppBase.metadata.create_all(bind=app_engine)
    mdb = SessionLocal()
    adb = AppSessionLocal()
    try:
        result = run_once(mdb, adb)
        print(json.dumps(result, indent=2))
    finally:
        mdb.close()
        adb.close()


if __name__ == "__main__":
    main()
