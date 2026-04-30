"""Helpers exposed to uploaded handler modules.

Uploaded `.py` files can do:

    from app.templates_userland.runtime import make_env
    _env = make_env(__file__)

…to get a Jinja environment whose loader includes both the module's own
folder (so `{form_code}.html.j2` resolves) and the built-in templates folder
(so `{% include '_spencer_design_system.css.j2' %}` works).
"""
from __future__ import annotations
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, ChoiceLoader, select_autoescape

# Built-in design-system templates (e.g. _spencer_design_system.css.j2) so
# uploaded handlers can {% include %} them without bundling a copy.
DESIGN_SYSTEM_DIR = Path(__file__).parent.parent / "reports" / "templates"


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
