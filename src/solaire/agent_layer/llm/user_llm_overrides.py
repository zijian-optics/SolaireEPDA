"""User-wide LLM overrides under the OS profile (see ``user_agent_paths``)."""

from __future__ import annotations

import json
from pathlib import Path

from solaire.agent_layer.user_agent_paths import user_agent_state_dir

_OVERRIDES_NAME = "llm_overrides.json"
_OVERRIDE_KEYS = ("api_key", "base_url", "provider", "main_model", "fast_model", "max_tokens")


def user_overrides_path() -> Path:
    return user_agent_state_dir() / _OVERRIDES_NAME


def load_user_overrides_raw() -> dict[str, str]:
    path = user_overrides_path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k in _OVERRIDE_KEYS:
        v = raw.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()
    return out


def save_user_overrides_raw(data: dict[str, str]) -> None:
    path = user_overrides_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not data:
        if path.is_file():
            path.unlink()
        return
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
