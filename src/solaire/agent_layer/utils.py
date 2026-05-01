"""Shared helpers for agent orchestration and tools."""

from __future__ import annotations

import json
from typing import Any


def parse_tool_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            return {}
    return {}


def tool_calls_signature(tool_calls: list[dict[str, Any]]) -> str:
    """Stable fingerprint for tool call batches (name + normalized arguments), order-independent."""
    normalized: list[tuple[str, str]] = []
    for tc in tool_calls:
        fn = tc.get("function") or {}
        name = str(fn.get("name") or "")
        raw = fn.get("arguments") or "{}"
        if isinstance(raw, str):
            try:
                args_obj = json.loads(raw) if raw.strip() else {}
            except json.JSONDecodeError:
                args_obj = None
        elif isinstance(raw, dict):
            args_obj = raw
        else:
            args_obj = None
        args_norm = json.dumps(args_obj, sort_keys=True, ensure_ascii=False) if args_obj is not None else str(raw)
        normalized.append((name, args_norm))
    normalized.sort(key=lambda x: (x[0], x[1]))
    return json.dumps(normalized, ensure_ascii=False)
