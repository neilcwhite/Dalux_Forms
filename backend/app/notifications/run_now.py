"""Manual trigger — runs one notification pass immediately.

    cd backend
    ./venv/Scripts/python.exe -m app.notifications.run_now           # live
    ./venv/Scripts/python.exe -m app.notifications.run_now --dry-run # candidates only
    ./venv/Scripts/python.exe -m app.notifications.run_now --no-teams # render+SP only

Useful for testing end-to-end without waiting for the 07:30-19:30 cron.
Honours NOTIFY_ENABLED just like the scheduled job.

Modes:
  (default)   Full pipeline: detect → render PDF → upload to SP → POST to
              Teams flow → record. Will fire real Teams cards.
  --dry-run   Detect candidates and print them. No render, no upload, no
              send, no DB writes. Safe to run any time.
  --no-teams  Detect → render → upload → record (status='sent' with
              http_status=0). Skips the Power Automate POST so doc-control
              don't see test cards. Useful for verifying SP upload on real
              closed forms before flipping the Teams switch.
"""
from __future__ import annotations
import argparse
import json
import logging

from app.database import SessionLocal, AppSessionLocal, app_engine, AppBase, migrate_app_db
from app.notifications.service import (
    find_candidates,
    record_notification,
    run_once,
    _render_and_upload,
)
from app.templates_userland import loader as template_loader

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print candidates only; no render/upload/send/DB writes")
    parser.add_argument("--no-teams", action="store_true",
                        help="Render + upload to SharePoint, but skip Teams POST")
    args = parser.parse_args()

    AppBase.metadata.create_all(bind=app_engine)
    migrate_app_db()
    # Register built-ins + scan templates_userland/ for uploads. Without
    # this, the registry is empty and every form fails the template_name
    # IN (...) filter.
    template_loader.initialize()
    mdb = SessionLocal()
    adb = AppSessionLocal()
    try:
        if args.dry_run:
            cands = find_candidates(mdb, adb)
            print(json.dumps(
                {
                    "mode": "dry-run",
                    "candidate_count": len(cands),
                    "candidates": [
                        {
                            "form_code": c.form_code,
                            "form_id": c.form_id,
                            "form_number": c.form_number,
                            "site_name": c.site_name,
                            "modified": c.modified.isoformat() if c.modified else None,
                        }
                        for c in cands
                    ],
                },
                indent=2,
            ))
            return

        if args.no_teams:
            cands = find_candidates(mdb, adb)
            results = []
            for c in cands:
                sp_url, err = _render_and_upload(c, mdb)
                if err:
                    results.append({"form_id": c.form_id, "outcome": "failed", "error": err})
                    record_notification(adb, c, status="failed", http_status=None,
                                        error_message=err, sharepoint_url=None)
                else:
                    results.append({"form_id": c.form_id, "outcome": "uploaded", "url": sp_url})
                    # Record as 'sent' so dedup blocks future passes — even
                    # though Teams was skipped, the file is on SP and the
                    # form is "handled" for this run's purposes.
                    record_notification(adb, c, status="sent", http_status=0,
                                        error_message=None, sharepoint_url=sp_url)
            print(json.dumps(
                {"mode": "no-teams", "results": results},
                indent=2,
            ))
            return

        result = run_once(mdb, adb)
        print(json.dumps(result, indent=2))
    finally:
        mdb.close()
        adb.close()


if __name__ == "__main__":
    main()
