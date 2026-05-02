"""Shared message helpers for LLM adapters (provider-agnostic)."""

from __future__ import annotations

from typing import Any


def ensure_assistant_tool_calls_have_reasoning(messages: list[dict[str, Any]]) -> None:
    """部分 OpenAI 兼容网关在 thinking 模式下要求 assistant+tool_calls 携带 reasoning_content（可为空串）。"""
    for m in messages:
        if m.get("role") != "assistant" or not m.get("tool_calls"):
            continue
        rc = m.get("reasoning_content")
        if rc is None:
            m["reasoning_content"] = ""
        else:
            m["reasoning_content"] = str(rc)
