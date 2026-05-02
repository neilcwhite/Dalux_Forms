"""Generates the Power Automate Adaptive Card JSON + trigger schema.

Run:
    cd backend
    ../venv/Scripts/python.exe ../scripts/build_teams_card_markup.py

Outputs two files into docs/teams_card/:
  - card_body.json       — paste into the flow's "Post Adaptive Card"
                            action's `Adaptive Card` field
  - trigger_schema.json  — paste into the flow's HTTP trigger schema

The card embeds the Spencer + Dalux marks as base64 data URIs so there's
no logo-hosting dependency. Re-run this script whenever the logos or
field set changes.
"""
from __future__ import annotations

import json
import pathlib

REPO_ROOT = pathlib.Path(__file__).parent.parent
BACKEND = REPO_ROOT / "backend"
OUT_DIR = REPO_ROOT / "docs" / "teams_card"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Logos were tried (base64 data URIs for Spencer + Dalux) but Adaptive Cards
# in Teams have no light/dark-mode awareness, so logos with light backgrounds
# render poorly in dark mode. Reverted to a logo-less design that leans on
# typography + a coloured accent bar — works the same in both themes.

# --- Trigger schema ---------------------------------------------------------

trigger_schema = {
    "type": "object",
    "properties": {
        "form_code": {"type": "string"},
        "form_id": {"type": "string"},
        "template_name": {"type": "string"},
        "template_display_name": {"type": "string"},
        "site_name": {"type": "string"},
        "sos_number": {"type": "string"},
        "form_number": {"type": "string"},
        "created_at": {"type": "string"},
        "created_label": {"type": "string"},
        "modified_at": {"type": "string"},
        "closed_label": {"type": "string"},
        "creator_name": {"type": "string"},
        "creator_email": {"type": "string"},
        "download_url": {"type": "string"},
        "folder_url": {"type": "string"},
    },
}

# --- Adaptive Card body -----------------------------------------------------
#
# Power Automate uses @{triggerBody()?['field']} to reference HTTP-trigger
# input. That syntax stays inside the JSON strings as literal text;
# Power Automate replaces it at send time.

card = {
    "type": "AdaptiveCard",
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "version": "1.4",
    "body": [
        {
            # Header — uses style "accent" so Teams paints it with the
            # current theme's accent colour, light- and dark-mode-safe.
            "type": "Container",
            "style": "accent",
            "bleed": True,
            "items": [
                {
                    "type": "TextBlock",
                    "text": "@{triggerBody()?['form_code']} closed — ready for QA",
                    "weight": "Bolder",
                    "size": "Large",
                    "wrap": True,
                },
                {
                    "type": "TextBlock",
                    "text": "@{triggerBody()?['template_display_name']}",
                    "isSubtle": True,
                    "spacing": "None",
                    "wrap": True,
                },
            ],
        },
        {
            "type": "TextBlock",
            "text": "@{triggerBody()?['site_name']}",
            "weight": "Bolder",
            "size": "Medium",
            "wrap": True,
            "spacing": "Medium",
        },
        {
            "type": "FactSet",
            "spacing": "Small",
            "facts": [
                {"title": "SOS #",     "value": "@{triggerBody()?['sos_number']}"},
                {"title": "Form No.",  "value": "@{triggerBody()?['form_number']}"},
                {"title": "Raised by", "value": "@{triggerBody()?['creator_name']}"},
                {"title": "Created",   "value": "@{triggerBody()?['created_label']}"},
                {"title": "Closed",    "value": "@{triggerBody()?['closed_label']}"},
                {"title": "Form ID",   "value": "@{triggerBody()?['form_id']}"},
            ],
        },
        {
            "type": "TextBlock",
            "text": "Form is closed in Dalux and the PDF is ready in SharePoint.",
            "wrap": True,
            "spacing": "Medium",
            "isSubtle": True,
        },
    ],
    "actions": [
        {
            "type": "Action.OpenUrl",
            "title": "Download PDF",
            "url": "@{triggerBody()?['download_url']}",
            "style": "positive",
        },
        {
            "type": "Action.OpenUrl",
            "title": "Open Folder",
            "url": "@{triggerBody()?['folder_url']}",
        },
    ],
}

# --- Write -------------------------------------------------------------------

(OUT_DIR / "trigger_schema.json").write_text(
    json.dumps(trigger_schema, indent=2), encoding="utf-8"
)
(OUT_DIR / "card_body.json").write_text(
    json.dumps(card, indent=2), encoding="utf-8"
)

print(f"trigger_schema.json: {(OUT_DIR / 'trigger_schema.json').stat().st_size:,} bytes")
print(f"card_body.json:      {(OUT_DIR / 'card_body.json').stat().st_size:,} bytes")
