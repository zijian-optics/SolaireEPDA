"""Shared helpers for agent orchestration and tools."""

from __future__ import annotations

import json
from typing import Any


def parse_tool_arguments(raw: Any) -> tuple[dict[str, Any], str | None]:
    """Parse tool call arguments, returning (parsed_dict, error_message_or_None).

    On JSON decode failure, the raw string is preserved in the error message
    so callers can surface it to the model for self-correction.
    """
    if isinstance(raw, dict):
        return raw, None
    if isinstance(raw, str):
        if not raw.strip():
            return {}, None
        try:
            return json.loads(raw), None
        except json.JSONDecodeError as e:
            snippet = raw[:200]
            return {}, f"JSON 解析失败: {e}. 原始输入片段: {snippet}"
    return {}, None


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
