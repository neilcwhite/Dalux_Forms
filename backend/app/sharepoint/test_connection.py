"""Connectivity test — run BEFORE wiring SharePoint into the scheduler.

    cd backend
    ./venv/Scripts/python.exe -m app.sharepoint.test_connection

What it does:
  1. Verifies the six SHAREPOINT_* env vars are populated.
  2. Acquires a Graph token (proves the app registration + secret are valid).
  3. Resolves the site id (proves the app has read access to the site).
  4. Uploads a tiny test file to the configured folder (proves write access).

On success: prints the SharePoint URL of the uploaded file. Open it in a
browser to confirm. The file is named with a timestamp so re-runs don't
collide; delete it manually after testing.

On failure: prints the offending step and the Graph error verbatim. The
most common failures and what they mean:
  - 'AADSTS7000215' / 'invalid_client'     → CLIENT_SECRET wrong/expired
  - 'AADSTS70011' / 'AADSTS90002'          → TENANT_ID wrong
  - 401 on site lookup                     → token is fine but the app
                                              registration lacks Sites.* perms
  - 403 on upload                          → app reg has read but not write
                                              (Sites.Read.All vs Sites.ReadWrite.All)
  - 404 on site lookup                     → HOSTNAME or SITE_PATH wrong
  - 404 on upload                          → FOLDER_PATH wrong (folder must
                                              exist; we don't create it)
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from app.config import settings
from app.sharepoint.client import SharePointClient, SharePointError


def _check_config() -> list[str]:
    missing = []
    for key in (
        "SHAREPOINT_TENANT_ID",
        "SHAREPOINT_CLIENT_ID",
        "SHAREPOINT_CLIENT_SECRET",
        "SHAREPOINT_HOSTNAME",
        "SHAREPOINT_SITE_PATH",
        "SHAREPOINT_FOLDER_PATH",
    ):
        if not getattr(settings, key, ""):
            missing.append(key)
    return missing


def main() -> int:
    print("== SharePoint connectivity test ==")
    print(f"  host:   {settings.SHAREPOINT_HOSTNAME}")
    print(f"  site:   {settings.SHAREPOINT_SITE_PATH}")
    print(f"  folder: {settings.SHAREPOINT_FOLDER_PATH}")
    print()

    missing = _check_config()
    if missing:
        print("FAIL — missing env vars: " + ", ".join(missing))
        return 2

    client = SharePointClient()

    print("[1/3] Getting Graph token…")
    try:
        client._get_token()  # noqa: SLF001 — intentional in a test CLI
    except SharePointError as e:
        print(f"FAIL — {e}")
        return 1
    print("      ok")

    print("[2/3] Resolving site id…")
    try:
        site_id = client._get_site_id()  # noqa: SLF001
    except SharePointError as e:
        print(f"FAIL — {e}")
        return 1
    print(f"      ok  (site id: {site_id})")

    print("[3/3] Uploading test file…")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"_dalux_forms_connectivity_test_{stamp}.txt"
    body = (
        f"Dalux Forms connectivity test\n"
        f"timestamp: {stamp}\n"
        f"This file was created by app.sharepoint.test_connection.\n"
        f"It is safe to delete.\n"
    ).encode("utf-8")
    try:
        result = client.upload(filename, body, content_type="text/plain")
    except SharePointError as e:
        print(f"FAIL — {e}")
        return 1

    print(f"      ok  ({result.size} bytes)")
    print()
    print("PASS. Open this URL in a browser to confirm:")
    print(f"  {result.web_url}")
    print()
    print(f"(Delete '{filename}' manually after verifying.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
