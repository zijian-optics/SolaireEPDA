"""Persistent manual paths for host extension executables (settings → 扩展组件)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from solaire.web.recent_projects import app_data_dir

PREFS_VERSION = 1
PREFS_FILENAME = "host_extension_paths.json"


def prefs_file() -> Path:
    return app_data_dir() / PREFS_FILENAME


def load_prefs() -> dict[str, Any]:
    """Return full prefs document: { \"v\": 1, \"extensions\": { ext_id: ... } }."""
    path = prefs_file()
    if not path.is_file():
        return {"v": PREFS_VERSION, "extensions": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"v": PREFS_VERSION, "extensions": {}}
    if not isinstance(data, dict):
        return {"v": PREFS_VERSION, "extensions": {}}
    v = data.get("v")
    if v != PREFS_VERSION:
        return {"v": PREFS_VERSION, "extensions": {}}
    exts = data.get("extensions")
    if not isinstance(exts, dict):
        return {"v": PREFS_VERSION, "extensions": {}}
    return {"v": PREFS_VERSION, "extensions": exts}


def save_prefs(doc: dict[str, Any]) -> None:
    path = prefs_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def get_extension_prefs(ext_id: str) -> dict[str, Any] | None:
    doc = load_prefs()
    raw = doc["extensions"].get(ext_id)
    return raw if isinstance(raw, dict) else None


def set_extension_prefs(ext_id: str, entry: dict[str, Any]) -> None:
    doc = load_prefs()
    doc["extensions"][ext_id] = entry
    save_prefs(doc)


def clear_extension_prefs(ext_id: str) -> bool:
    doc = load_prefs()
    if ext_id not in doc["extensions"]:
        return False
    del doc["extensions"][ext_id]
    save_prefs(doc)
    return True
