"""Helpers exposed to uploaded handler modules.

Uploaded `.py` files can do:

    from app.templates_userland.runtime import make_env, qr_data_uri
    _env = make_env(__file__)
    _qr = qr_data_uri(__file__)   # returns a data: URI or None

…to get a Jinja environment whose loader includes both the module's own
folder (so `{form_code}.html.j2` resolves) and the built-in templates folder
(so `{% include '_spencer_design_system.css.j2' %}` works), plus a helper
to embed an uploaded QR image into the report.
"""
from __future__ import annotations
import base64
from pathlib import Path
from typing import Optional
from jinja2 import Environment, FileSystemLoader, ChoiceLoader, select_autoescape

# Built-in design-system templates (e.g. _spencer_design_system.css.j2) so
# uploaded handlers can {% include %} them without bundling a copy.
DESIGN_SYSTEM_DIR = Path(__file__).parent.parent / "reports" / "templates"

# Recognised QR image extensions, in priority order. Matches loader.QR_EXTENSIONS.
_QR_EXTS = (".png", ".jpg", ".jpeg")


def make_env(handler_file: str) -> Environment:
    """Build a Jinja Environment for an uploaded handler module.
    Pass `__file__` from the handler. The env's loader looks first in the
    handler's own directory, then in the built-in design-system templates
    folder."""
    own_dir = Path(handler_file).parent
    return Environment(
        loader=ChoiceLoader([
            FileSystemLoader(str(own_dir)),
            FileSystemLoader(str(DESIGN_SYSTEM_DIR)),
        ]),
        autoescape=select_autoescape(["html", "xml"]),
    )


def qr_data_uri(handler_file: str) -> Optional[str]:
    """Return a `data:image/...;base64,...` URI for the QR image uploaded
    alongside this handler, or None if no QR was uploaded for this version.

    Pass `__file__` from the handler. The helper looks for `qr.png`,
    `qr.jpg`, or `qr.jpeg` in the same directory as the handler.
    """
    own_dir = Path(handler_file).parent
    for ext in _QR_EXTS:
        candidate = own_dir / f"qr{ext}"
        if candidate.exists():
            data = candidate.read_bytes()
            mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
            return f"data:{mime};base64,{base64.b64encode(data).decode()}"
    return None
