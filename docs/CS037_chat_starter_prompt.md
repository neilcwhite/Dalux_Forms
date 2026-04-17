# Starter prompt — copy this into the new chat

---

I'm continuing the Dalux Forms project. Current state documented in `docs/DALUX_PROJECT_SCOPE_v3.3.md` and the design playbook in `docs/template-design-playbook.md` — I've uploaded both to this chat.

**New task: design the CS037 Permit to Undertake Hotwork report template.**

Context:
- Spencer form code: **CS037**
- Dalux template_name: **"Permit to undertake hot work"** (exact match)
- **This is a permit, not a checklist** — Family B in the design playbook, not Family A like CS053
- No design sessions have happened for this template yet
- CS053 is in production and working — we're extending the system, not replacing it

What I need you to do this session:

**1. Pull real data to understand the form shape.**

I'll run queries from my laptop and paste results back. I need you to tell me what to run. Start by asking me to run queries that show:
- How many CS037 forms exist in the DB (`DLX_2_forms WHERE template_name = 'Permit to undertake hot work'`)
- What UDF field names appear on a sample CS037 form
- What attachment types are typical (photos, signatures, etc.)
- Whether CS037 forms link to tasks/CARs like CS053 does

Once I paste results, you can identify the actual data structure.

**2. Ask me about the paper form / Dalux UX.**

I may have:
- An existing paper/Word version of CS037 I can share as an image/PDF
- A Dalux screenshot of what the form looks like in the app
- A sample PDF output from Dalux's built-in export

If I haven't shared any of those, ask me — seeing the existing form makes design much faster than reverse-engineering from field names.

**3. Propose an initial layout.**

Based on real data + reference material, propose the layout. Use the design playbook conventions where applicable (Spencer branding, page footer, filename pattern, owner chips, photos with numbered badges, asset prefix naming `CS037_*`). Deviate where the permit shape demands — and flag the deviations explicitly so I know what's different from CS053.

**4. Iterate via rendered mock.**

Same workflow as CS053: you render a mock HTML + PDF using sample/placeholder data, I review, we refine. Don't wire it into the actual backend yet — that's a Claude Code task for after design approval.

**5. When design is locked, give me a handoff package for Claude Code.**

Three things:
- `backend/app/reports/templates/cs037.html.j2` — the Jinja template
- `backend/app/reports/cs037.py` — the builder module (data extraction + render_html)
- A plain-language spec of what the builder expects from the database, so Claude Code can verify column names match what's actually in the DB before wiring it in

Once design's approved I'll open Claude Code and get it wired into:
- `TEMPLATE_HANDLERS` registry in `service.py`
- `TEMPLATES_WITH_CUSTOM_REPORT` dict in `main.py` (with `code: "CS037"` and `display: "CS037 — Permit to undertake hot work"`)
- Photo asset in `static/` with `CS037_*` prefix

**Constraints inherited from CS053:**
- Python + Jinja2 + WeasyPrint stack (no alternatives)
- UDF-driven data where applicable
- Site Name / Project No. always from `DLX_2_projects` / `sheq_sites` join, never from UDFs
- Every join uses `COLLATE utf8mb4_unicode_ci` on both sides
- No per-item modification history available (form-level attribution only — already documented in audit_limitations.md, no need to re-flag in the template)

Let's start. First question — what do you want me to query first?

---

## Files to upload in the new chat

Before you paste the prompt above, upload these two files to the new chat:

1. `DALUX_PROJECT_SCOPE_v3.3.md` — gives full project context
2. `template-design-playbook.md` — gives the reusable design conventions

Both are in `docs/` in the project folder after you save them.

## Also helpful to have ready

- A sample CS037 form ID you'd like to work from (query `DLX_2_forms WHERE template_name = 'Permit to undertake hot work' ORDER BY created DESC LIMIT 10`)
- The existing CS037 paper/Word form if one exists (or a Dalux screenshot showing the form fields in the app)
- Current `cs053.py` and `cs053.html.j2` pasted into the chat at some point — useful when I'm building the CS037 equivalents and want to mirror the structure
