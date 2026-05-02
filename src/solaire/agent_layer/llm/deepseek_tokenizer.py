"""DeepSeek V3 仓库内 tokenizer：用于侧栏上下文用量估算（可选依赖 `tokenizers`）。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from solaire.agent_layer.llm.providers import LlmProvider, is_deepseek_openai_compat

# 产品公开口径：百万级上下文窗口（与网关文档/营销一致；UI 按比例展示用量）
DEEPSEEK_PUBLIC_CONTEXT_LIMIT = 1_000_000


def use_deepseek_context_meter(provider: LlmProvider, base_url: str | None) -> bool:
    return is_deepseek_openai_compat(provider, base_url)


@lru_cache(maxsize=1)
def _tokenizer_json_path() -> Path | None:
    here = Path(__file__).resolve()
    if len(here.parents) >= 5:
        cand = here.parents[4] / "deepseek_v3_tokenizer" / "tokenizer.json"
        if cand.is_file():
            return cand
    return None


@lru_cache(maxsize=1)
def _loaded_tokenizer():  # type: ignore[no-untyped-def]
    try:
        from tokenizers import Tokenizer  # type: ignore[import-not-found]
    except ImportError:
        return None
    p = _tokenizer_json_path()
    if not p:
        return None
    try:
        return Tokenizer.from_file(str(p))
    except Exception:
        return None


def _message_fingerprint(m: dict[str, Any]) -> str:
    role = str(m.get("role") or "")
    parts: list[str] = [role]
    c = m.get("content")
    if c is not None and str(c).strip() != "":
        parts.append(str(c))
    r = m.get("reasoning_content")
    if r is not None and str(r).strip() != "":
        parts.append(str(r))
    tc = m.get("tool_calls")
    if tc:
        parts.append(str(tc))
    if m.get("role") == "tool":
        tid = m.get("tool_call_id")
        if tid:
            parts.append(str(tid))
        nm = m.get("name")
        if nm:
            parts.append(str(nm))
    return "\n".join(parts)


def estimate_deepseek_messages_tokens(messages: list[dict[str, Any]]) -> int | None:
    tok = _loaded_tokenizer()
    if tok is None:
        return None
    total = 0
    for m in messages:
        enc = tok.encode(_message_fingerprint(m), add_special_tokens=False)
        total += len(enc.ids)
    return total


def context_limit_for_provider(provider: LlmProvider, base_url: str | None) -> int | None:
    if use_deepseek_context_meter(provider, base_url):
        return DEEPSEEK_PUBLIC_CONTEXT_LIMIT
    return None


def estimate_context_prompt_tokens(
    provider: LlmProvider,
    base_url: str | None,
    messages: list[dict[str, Any]],
) -> int:
    if use_deepseek_context_meter(provider, base_url):
        ds = estimate_deepseek_messages_tokens(messages)
        if ds is not None:
            return ds
    from solaire.agent_layer.llm.token_budget import estimate_messages_tokens

    return estimate_messages_tokens(messages)
