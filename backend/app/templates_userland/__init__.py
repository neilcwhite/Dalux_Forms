"""User-uploadable template handlers + version registry.

See docs/template_upload_plan.md for architecture. Public surface:
  - loader.initialize()  — call at app startup
  - loader.resolve_handler(dalux_template_name, form_created) -> module | None
  - loader.get_templates_with_custom_report() -> dict
  - loader.has_custom_report(dalux_template_name) -> bool
  - loader.list_versions() -> dict[form_code, list[TemplateVersion]]
  - loader.upload(...) / disable(...) / enable(...) / delete(...)
"""
