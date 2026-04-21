"""Teams notifications for closed forms ready for download.

See docs/teams_notifications_plan.md for architecture. Entry point is
scheduler.py (APScheduler cron) which calls service.run_once().
"""
