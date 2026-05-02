"""模型服务预设与对外枚举（服务端内部 id；界面文案由前端 i18n 负责）。"""

from __future__ import annotations

from typing import Literal, TypedDict

LlmProvider = Literal["openai", "anthropic", "openai_compat", "deepseek"]

VALID_PROVIDERS: tuple[LlmProvider, ...] = ("openai", "anthropic", "openai_compat", "deepseek")

ReasoningEffort = Literal["high", "max"]


def normalize_reasoning_effort(raw: str | None) -> ReasoningEffort:
    """DeepSeek 思考强度：仅 high / max；非法或缺省为 high。"""
    if raw is None or not str(raw).strip():
        return "high"
    v = str(raw).strip().lower()
    if v == "max":
        return "max"
    return "high"


def is_deepseek_openai_compat(provider: LlmProvider, base_url: str | None) -> bool:
    """是否与 DeepSeek 官方 OpenAI 兼容网关同路径（思考模式、消息回传等）。"""
    if provider == "deepseek":
        return True
    if base_url and "deepseek.com" in base_url.lower():
        return True
    return False


class ProviderOptionDict(TypedDict):
    id: LlmProvider


def normalize_provider(raw: str | None) -> LlmProvider:
    if raw is None or not str(raw).strip():
        return "openai_compat"
    v = str(raw).strip().lower()
    if v in VALID_PROVIDERS:
        return v  # type: ignore[return-value]
    return "openai_compat"


def provider_default_base_url(provider: LlmProvider) -> str | None:
    if provider == "deepseek":
        return "https://api.deepseek.com"
    return None


def provider_default_models(provider: LlmProvider) -> tuple[str, str]:
    if provider == "openai":
        return ("gpt-4o-mini", "gpt-4o-mini")
    if provider == "anthropic":
        return ("claude-sonnet-4-20250514", "claude-3-5-haiku-20241022")
    if provider == "deepseek":
        return ("deepseek-v4-pro", "deepseek-v4-flash")
    return ("gpt-4o-mini", "gpt-4o-mini")


def list_provider_options_for_api() -> list[ProviderOptionDict]:
    return [{"id": "deepseek"}, {"id": "openai"}, {"id": "anthropic"}, {"id": "openai_compat"}]
