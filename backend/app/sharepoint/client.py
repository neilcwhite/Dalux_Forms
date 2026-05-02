"""Microsoft Graph client for SharePoint uploads.

Minimal — token caching + site/drive resolution + file upload. No msal
dependency, just `requests`. Token cache is process-local (one per worker);
that's fine for a single uvicorn container.

Graph endpoints used:
  POST  /{tenant}/oauth2/v2.0/token                     — client_credentials
  GET   /v1.0/sites/{host}:/{site-path}                 — resolve site id
  GET   /v1.0/sites/{site-id}/drive                     — default doc library
  PUT   /v1.0/sites/{site-id}/drive/root:/{path}:/content  — upload (<4 MB)
  POST  /v1.0/sites/{site-id}/drive/root:/{path}:/createUploadSession
                                                          — upload (>=4 MB)
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote

import requests

from app.config import settings

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
LOGIN_BASE = "https://login.microsoftonline.com"

# Files smaller than this go in a single PUT; larger ones use an upload
# session. Graph documents 4 MB as the simple-upload ceiling.
SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024

# Each chunk in a session upload must be a multiple of 320 KiB and Graph
# recommends 5–10 MiB. 5 MiB hits the sweet spot.
SESSION_CHUNK = 5 * 1024 * 1024


class SharePointError(RuntimeError):
    """Raised for any failure talking to Graph — auth, lookup, or upload."""


@dataclass
class _CachedToken:
    value: str
    expires_at: float  # unix epoch


@dataclass
class UploadResult:
    name: str
    web_url: str
    size: int


class SharePointClient:
    def __init__(self) -> None:
        self._token: Optional[_CachedToken] = None
        self._site_id: Optional[str] = None

    # -- auth -----------------------------------------------------------------

    def _get_token(self) -> str:
        """Fetch (and cache) a Graph access token via client_credentials."""
        now = time.time()
        if self._token and self._token.expires_at - 300 > now:
            return self._token.value

        if not all([
            settings.SHAREPOINT_TENANT_ID,
            settings.SHAREPOINT_CLIENT_ID,
            settings.SHAREPOINT_CLIENT_SECRET,
        ]):
            raise SharePointError(
                "SharePoint not configured — set SHAREPOINT_TENANT_ID, "
                "SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET in .env"
            )

        url = f"{LOGIN_BASE}/{settings.SHAREPOINT_TENANT_ID}/oauth2/v2.0/token"
        try:
            resp = requests.post(
                url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": settings.SHAREPOINT_CLIENT_ID,
                    "client_secret": settings.SHAREPOINT_CLIENT_SECRET,
                    "scope": "https://graph.microsoft.com/.default",
                },
                timeout=30,
            )
        except requests.RequestException as e:
            raise SharePointError(f"token request failed: {e}") from e

        if resp.status_code != 200:
            raise SharePointError(
                f"token request returned {resp.status_code}: {resp.text[:300]}"
            )
        body = resp.json()
        self._token = _CachedToken(
            value=body["access_token"],
            expires_at=now + int(body.get("expires_in", 3600)),
        )
        return self._token.value

    def _headers(self, extra: Optional[dict] = None) -> dict:
        h = {"Authorization": f"Bearer {self._get_token()}"}
        if extra:
            h.update(extra)
        return h

    # -- site/drive resolution ------------------------------------------------

    def _get_site_id(self) -> str:
        if self._site_id:
            return self._site_id
        host = settings.SHAREPOINT_HOSTNAME
        site_path = settings.SHAREPOINT_SITE_PATH
        if not host or not site_path:
            raise SharePointError(
                "SHAREPOINT_HOSTNAME / SHAREPOINT_SITE_PATH not set"
            )
        # Graph wants `host:/sites/foo` — site_path must start with `/`.
        site_path = "/" + site_path.lstrip("/")
        url = f"{GRAPH_BASE}/sites/{host}:{site_path}"
        resp = requests.get(url, headers=self._headers(), timeout=30)
        if resp.status_code != 200:
            raise SharePointError(
                f"site lookup failed ({resp.status_code}): {resp.text[:300]}"
            )
        self._site_id = resp.json()["id"]
        return self._site_id

    # -- upload ---------------------------------------------------------------

    def upload(
        self,
        filename: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> UploadResult:
        """Upload `content` as `filename` into SHAREPOINT_FOLDER_PATH."""
        site_id = self._get_site_id()
        folder = settings.SHAREPOINT_FOLDER_PATH.strip("/")
        # "01 New Documents/CS053_xyz.pdf" — Graph URL-encodes path segments.
        item_path = f"{folder}/{filename}" if folder else filename
        encoded_path = quote(item_path, safe="/")

        if len(content) < SIMPLE_UPLOAD_LIMIT:
            return self._simple_upload(site_id, encoded_path, content, content_type)
        return self._session_upload(site_id, encoded_path, content, content_type)

    def _simple_upload(
        self, site_id: str, encoded_path: str, content: bytes, content_type: str,
    ) -> UploadResult:
        url = f"{GRAPH_BASE}/sites/{site_id}/drive/root:/{encoded_path}:/content"
        resp = requests.put(
            url,
            headers=self._headers({"Content-Type": content_type}),
            data=content,
            timeout=120,
        )
        if resp.status_code not in (200, 201):
            raise SharePointError(
                f"upload failed ({resp.status_code}): {resp.text[:300]}"
            )
        body = resp.json()
        return UploadResult(
            name=body.get("name", ""),
            web_url=body.get("webUrl", ""),
            size=int(body.get("size", len(content))),
        )

    def _session_upload(
        self, site_id: str, encoded_path: str, content: bytes, content_type: str,
    ) -> UploadResult:
        # Replace existing if present; doc control reuploads happen.
        create_url = (
            f"{GRAPH_BASE}/sites/{site_id}/drive/root:/{encoded_path}"
            f":/createUploadSession"
        )
        resp = requests.post(
            create_url,
            headers=self._headers({"Content-Type": "application/json"}),
            json={"item": {"@microsoft.graph.conflictBehavior": "replace"}},
            timeout=30,
        )
        if resp.status_code not in (200, 201):
            raise SharePointError(
                f"createUploadSession failed ({resp.status_code}): "
                f"{resp.text[:300]}"
            )
        upload_url = resp.json()["uploadUrl"]
        total = len(content)
        offset = 0
        last_body: dict = {}
        while offset < total:
            end = min(offset + SESSION_CHUNK, total) - 1
            chunk = content[offset:end + 1]
            headers = {
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {offset}-{end}/{total}",
                "Content-Type": content_type,
            }
            # Note: upload_url is pre-authenticated; do NOT send Bearer token.
            r = requests.put(upload_url, headers=headers, data=chunk, timeout=300)
            if r.status_code not in (200, 201, 202):
                raise SharePointError(
                    f"chunk upload failed ({r.status_code}) at offset "
                    f"{offset}: {r.text[:300]}"
                )
            if r.status_code in (200, 201):
                last_body = r.json()
            offset = end + 1

        return UploadResult(
            name=last_body.get("name", ""),
            web_url=last_body.get("webUrl", ""),
            size=int(last_body.get("size", total)),
        )


_singleton: Optional[SharePointClient] = None


def get_client() -> SharePointClient:
    """Return the process-wide SharePoint client (token cache lives here)."""
    global _singleton
    if _singleton is None:
        _singleton = SharePointClient()
    return _singleton
