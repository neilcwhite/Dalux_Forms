"""Dynamic template loader + version registry.

In-memory registry shape:
    _versions: dict[form_code, list[TemplateVersion]]   # sorted by version asc

Resolution rule (resolve_handler):
    Given (dalux_template_name, form.created) → return the module of the
    highest-numbered, non-disabled version whose VALID_FROM ≤ form.created.
    If no version qualifies, fall back to the earliest with a logged warning.

Built-ins (CS037 / CS053 / CS208) register as v1 with VALID_FROM = epoch and
source='builtin'. Uploads slot in as v2, v3, … under the same form_code.
"""
from __future__ import annotations
import hashlib
import importlib
import importlib.util
import json
import logging
import shutil
import sys
import threading
from dataclasses import dataclass, asdict
from datetime import date, datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# --- Paths ---
BACKEND_ROOT = Path(__file__).parent.parent.parent  # backend/
USERLAND_DIR = BACKEND_ROOT / "data" / "templates_userland"
USERLAND_DIR.mkdir(parents=True, exist_ok=True)
TMP_UPLOAD_DIR = BACKEND_ROOT / "data" / "templates_userland_tmp"
TMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

EPOCH = date(1970, 1, 1)

# --- Built-in registration table ---
# Built-ins live in app/reports/ and ship in the Docker image. They register
# as v1 with EPOCH valid_from so they always cover the historical floor.
BUILTIN_DEFINITIONS = [
    {
        "form_code": "CS037",
        "dalux_template_name": "Permit to Undertake Hot Work",
        "form_display": "CS037 — Permit to undertake hot work",
        "module_path": "app.reports.cs037",
    },
    {
        "form_code": "CS053",
        "dalux_template_name": "Weekly Safety inspection",
        "form_display": "CS053 — Weekly Safety inspection",
        "module_path": "app.reports.cs053",
    },
    {
        "form_code": "CS208",
        "dalux_template_name": "Protective Coating Inspection (Complete)",
        "form_display": "CS208 — Protective Coating Inspection Report",
        "module_path": "app.reports.cs208",
    },
]


@dataclass
class TemplateVersion:
    form_code: str
    version: int
    source: str                 # "builtin" | "uploaded"
    valid_from: date            # EPOCH for built-ins
    dalux_template_name: str
    form_display: str
    disabled: bool
    uploaded_at: Optional[datetime]
    folder_path: Optional[Path]
    python_sha256: Optional[str]
    template_sha256: Optional[str]
    module: object              # the imported handler module


_versions: dict[str, list[TemplateVersion]] = {}
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Init / scan
# ---------------------------------------------------------------------------

def initialize() -> None:
    """Called at FastAPI startup. Registers built-ins, then scans the userland
    volume for any previously-uploaded versions."""
    with _lock:
        _versions.clear()
        _register_builtins()
        _scan_userland()
    counts = {k: len(v) for k, v in _versions.items()}
    logger.info("template registry initialized: %s", counts)


def _register_builtins() -> None:
    for spec in BUILTIN_DEFINITIONS:
        try:
            mod = importlib.import_module(spec["module_path"])
        except Exception as e:
            logger.error("failed to import built-in %s: %s", spec["module_path"], e)
            continue
        v = TemplateVersion(
            form_code=spec["form_code"],
            version=1,
            source="builtin",
            valid_from=EPOCH,
            dalux_template_name=spec["dalux_template_name"],
            form_display=spec["form_display"],
            disabled=False,
            uploaded_at=None,
            folder_path=None,
            python_sha256=None,
            template_sha256=None,
            module=mod,
        )
        _versions.setdefault(spec["form_code"], []).append(v)


def _scan_userland() -> None:
    """Walk templates_userland/{form_code}/v{N}/ folders and import each."""
    if not USERLAND_DIR.exists():
        return
    for code_dir in sorted(USERLAND_DIR.iterdir()):
        if not code_dir.is_dir():
            continue
        form_code = code_dir.name
        for version_dir in sorted(code_dir.iterdir(), key=_version_sort_key):
            if not version_dir.is_dir() or not version_dir.name.startswith("v"):
                continue
            try:
                version_num = int(version_dir.name[1:])
            except ValueError:
                continue
            try:
                v = _load_version_from_disk(form_code, version_num, version_dir)
                _versions.setdefault(form_code, []).append(v)
                logger.info("loaded uploaded template %s v%d from %s",
                            form_code, version_num, version_dir)
            except Exception as e:
                logger.error("failed to load %s/v%d: %s", form_code, version_num, e)


def _version_sort_key(p: Path) -> int:
    name = p.name
    if name.startswith("v"):
        try:
            return int(name[1:])
        except ValueError:
            pass
    return 0


def _load_version_from_disk(form_code: str, version_num: int, folder: Path) -> TemplateVersion:
    py_path = folder / f"{form_code}.py"
    j2_path = folder / f"{form_code}.html.j2"
    meta_path = folder / "_meta.json"
    if not py_path.exists() or not j2_path.exists():
        raise FileNotFoundError(f"missing .py or .html.j2 in {folder}")

    meta = {}
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))

    module = _import_module_from_path(form_code, version_num, py_path)
    _validate_module(module, form_code)

    valid_from_str = meta.get("valid_from") or getattr(module, "VALID_FROM")
    valid_from = date.fromisoformat(valid_from_str)
    uploaded_at_str = meta.get("uploaded_at")
    uploaded_at = datetime.fromisoformat(uploaded_at_str) if uploaded_at_str else None

    return TemplateVersion(
        form_code=form_code,
        version=version_num,
        source="uploaded",
        valid_from=valid_from,
        dalux_template_name=getattr(module, "DALUX_TEMPLATE_NAME"),
        form_display=getattr(module, "FORM_DISPLAY", form_code),
        disabled=bool(meta.get("disabled", False)),
        uploaded_at=uploaded_at,
        folder_path=folder,
        python_sha256=meta.get("python_sha256") or _sha256(py_path),
        template_sha256=meta.get("template_sha256") or _sha256(j2_path),
        module=module,
    )


def _import_module_from_path(form_code: str, version_num: int, py_path: Path):
    """Import an uploaded .py at a unique fully-qualified name so multiple
    versions don't clobber each other in sys.modules."""
    qualname = f"app.templates_userland._loaded.{form_code}_v{version_num}"
    spec = importlib.util.spec_from_file_location(qualname, str(py_path))
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot create spec for {py_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[qualname] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(qualname, None)
        raise
    return module


REQUIRED_ATTRS = ("DALUX_TEMPLATE_NAME", "FORM_CODE", "FORM_DISPLAY", "VALID_FROM",
                  "build_payload", "render_html")


def _validate_module(module, expected_form_code: Optional[str] = None) -> None:
    missing = [a for a in REQUIRED_ATTRS if not hasattr(module, a)]
    if missing:
        raise ValueError(f"module missing required attribute(s): {', '.join(missing)}")
    if not callable(getattr(module, "build_payload")):
        raise ValueError("build_payload must be callable")
    if not callable(getattr(module, "render_html")):
        raise ValueError("render_html must be callable")
    try:
        date.fromisoformat(getattr(module, "VALID_FROM"))
    except (TypeError, ValueError):
        raise ValueError("VALID_FROM must be an ISO date string like '2026-04-30'")
    if expected_form_code and getattr(module, "FORM_CODE").lower() != expected_form_code.lower():
        raise ValueError(
            f"FORM_CODE in module ({module.FORM_CODE!r}) does not match folder name ({expected_form_code!r})"
        )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------

def resolve_handler(dalux_template_name: str, form_created) -> Optional[object]:
    """Pick the right handler module for a form. See module docstring for
    the resolution rule."""
    form_code = _form_code_for_dalux(dalux_template_name)
    if not form_code:
        return None
    versions = _versions.get(form_code, [])
    active = [v for v in versions if not v.disabled]
    if not active:
        return None
    form_date = _to_date(form_created)
    eligible = [v for v in active if v.valid_from <= form_date]
    if not eligible:
        earliest = min(active, key=lambda v: v.version)
        logger.warning(
            "form created %s predates earliest version of %s (v%d valid_from=%s); using v%d",
            form_date, form_code, earliest.version, earliest.valid_from, earliest.version,
        )
        return earliest.module
    return max(eligible, key=lambda v: v.version).module


def _form_code_for_dalux(dalux_template_name: str) -> Optional[str]:
    for code, versions in _versions.items():
        if versions and versions[0].dalux_template_name == dalux_template_name:
            return code
    return None


def _to_date(d) -> date:
    if isinstance(d, date) and not isinstance(d, datetime):
        return d
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, str):
        return date.fromisoformat(d[:10])
    return EPOCH


# ---------------------------------------------------------------------------
# Convenience functions for callers (replace TEMPLATES_WITH_CUSTOM_REPORT dict)
# ---------------------------------------------------------------------------

def get_templates_with_custom_report() -> dict:
    """Returns {dalux_template_name: {code, display}} of currently-active
    templates (any non-disabled version of each form_code counts). Used by
    /api/forms, /api/form-types, /api/sites/form-summary, notifications."""
    out = {}
    for code, versions in _versions.items():
        active = [v for v in versions if not v.disabled]
        if not active:
            continue
        latest = max(active, key=lambda v: v.version)
        out[latest.dalux_template_name] = {"code": code, "display": latest.form_display}
    return out


def has_custom_report(dalux_template_name: str) -> bool:
    return dalux_template_name in get_templates_with_custom_report()


def list_versions() -> dict[str, list[TemplateVersion]]:
    """Snapshot of the current registry for the admin UI."""
    return {k: list(v) for k, v in _versions.items()}


def serialize_versions() -> list[dict]:
    """Flat list, ready for JSON response."""
    out = []
    for code in sorted(_versions.keys()):
        for v in sorted(_versions[code], key=lambda x: x.version):
            out.append({
                "form_code": v.form_code,
                "version": v.version,
                "source": v.source,
                "valid_from": v.valid_from.isoformat(),
                "dalux_template_name": v.dalux_template_name,
                "form_display": v.form_display,
                "disabled": v.disabled,
                "uploaded_at": v.uploaded_at.isoformat() if v.uploaded_at else None,
                "python_sha256": v.python_sha256,
                "template_sha256": v.template_sha256,
            })
    return out


# ---------------------------------------------------------------------------
# Mutation — upload, disable, enable, delete
# ---------------------------------------------------------------------------

class UploadError(Exception):
    """Raised when an upload is rejected before any files are written.
    Caller should record an audit row with outcome='rejected'."""


def upload(python_bytes: bytes, template_bytes: bytes) -> TemplateVersion:
    """Validate and register a new version. The form_code, valid_from, and
    dalux_template_name are read from the .py module (after validation
    import). On success, files are persisted to templates_userland/{code}/v{N}/.
    """
    with _lock:
        # 1. Validate import in a temp location first so a broken upload
        #    doesn't pollute the userland folder.
        tmp_dir = TMP_UPLOAD_DIR / f"upload_{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            # Write candidate files with a placeholder name; we'll rename once
            # we know the form_code from the module.
            tmp_py = tmp_dir / "candidate.py"
            tmp_j2 = tmp_dir / "candidate.html.j2"
            tmp_py.write_bytes(python_bytes)
            tmp_j2.write_bytes(template_bytes)

            # Import + validate
            qualname = f"app.templates_userland._tmp_validate_{tmp_dir.name}"
            spec = importlib.util.spec_from_file_location(qualname, str(tmp_py))
            if spec is None or spec.loader is None:
                raise UploadError("cannot read candidate .py")
            module = importlib.util.module_from_spec(spec)
            sys.modules[qualname] = module
            try:
                spec.loader.exec_module(module)
            except Exception as e:
                raise UploadError(f"candidate .py failed to import: {e}")
            finally:
                sys.modules.pop(qualname, None)

            try:
                _validate_module(module)
            except ValueError as e:
                raise UploadError(str(e))

            form_code = getattr(module, "FORM_CODE")
            dalux_name = getattr(module, "DALUX_TEMPLATE_NAME")
            valid_from = getattr(module, "VALID_FROM")
            form_display = getattr(module, "FORM_DISPLAY")

            # 2. Cross-version invariants
            existing = _versions.get(form_code, [])
            if existing:
                established_dalux = existing[0].dalux_template_name
                if established_dalux != dalux_name:
                    raise UploadError(
                        f"DALUX_TEMPLATE_NAME locked once form_code is established: "
                        f"existing={established_dalux!r}, upload={dalux_name!r}"
                    )

            # 3. Allocate next version number
            next_version = max((v.version for v in existing), default=0) + 1
            target_dir = USERLAND_DIR / form_code / f"v{next_version}"
            target_dir.mkdir(parents=True, exist_ok=False)

            # 4. Move files into place with canonical names
            target_py = target_dir / f"{form_code}.py"
            target_j2 = target_dir / f"{form_code}.html.j2"
            shutil.move(str(tmp_py), str(target_py))
            shutil.move(str(tmp_j2), str(target_j2))

            py_sha = _sha256(target_py)
            j2_sha = _sha256(target_j2)
            uploaded_at = datetime.utcnow()

            meta = {
                "valid_from": valid_from,
                "uploaded_at": uploaded_at.isoformat(),
                "python_sha256": py_sha,
                "template_sha256": j2_sha,
                "disabled": False,
                "form_display": form_display,
                "dalux_template_name": dalux_name,
            }
            (target_dir / "_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

            # 5. Re-import from the final location so __file__ is correct (so
            #    runtime.make_env(__file__) resolves relative to the actual folder).
            v = _load_version_from_disk(form_code, next_version, target_dir)
            _versions.setdefault(form_code, []).append(v)
            return v
        finally:
            # Clean up tmp_dir if it still has anything
            shutil.rmtree(tmp_dir, ignore_errors=True)


def disable(form_code: str, version_num: int) -> None:
    with _lock:
        v = _find(form_code, version_num)
        if v.source == "builtin":
            raise UploadError("cannot disable a built-in version")
        v.disabled = True
        _persist_meta(v)


def enable(form_code: str, version_num: int) -> None:
    with _lock:
        v = _find(form_code, version_num)
        v.disabled = False
        _persist_meta(v)


def delete(form_code: str, version_num: int) -> None:
    with _lock:
        v = _find(form_code, version_num)
        if v.source == "builtin":
            raise UploadError("cannot delete a built-in version")
        if v.folder_path and v.folder_path.exists():
            shutil.rmtree(v.folder_path)
        # Remove parent code dir if it becomes empty
        if v.folder_path and v.folder_path.parent.exists() and not any(v.folder_path.parent.iterdir()):
            v.folder_path.parent.rmdir()
        _versions[form_code] = [x for x in _versions.get(form_code, []) if x.version != version_num]


def _find(form_code: str, version_num: int) -> TemplateVersion:
    for v in _versions.get(form_code, []):
        if v.version == version_num:
            return v
    raise UploadError(f"no such version: {form_code} v{version_num}")


def _persist_meta(v: TemplateVersion) -> None:
    if not v.folder_path:
        return
    meta_path = v.folder_path / "_meta.json"
    meta = {}
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["disabled"] = v.disabled
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
