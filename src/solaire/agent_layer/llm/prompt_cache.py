"""Prompt cache friendliness helpers."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def stable_prefix_hint() -> str:
    """提示：稳定前缀应包含角色/任务范围/工具表/约束等，见 prompts.build_stable_system_prompt。"""
    return "stable_prefix:build_stable_system_prompt"


def hash_text_sha12(text: str) -> str:
    """文本 sha256 前 12 位，便于轻量可观测。"""
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:12]


def hash_tools_payload_sha12(tools_payload: list[dict[str, Any]]) -> str:
    """工具 schema 序列化后哈希；相同工具集应得到稳定值。"""
    raw = json.dumps(tools_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hash_text_sha12(raw)


def hash_messages_slice_sha12(messages: list[dict[str, Any]], *, start: int) -> str:
    """对消息数组片段做稳定序列化哈希（不含前缀 system）。"""
    slice_ = messages[start:] if start < len(messages) else []
    raw = json.dumps(slice_, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hash_text_sha12(raw)
