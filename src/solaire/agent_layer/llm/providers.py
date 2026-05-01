"""模型服务预设与对外枚举（服务端内部 id；界面文案由前端 i18n 负责）。"""

from __future__ import annotations

from typing import Literal, TypedDict

LlmProvider = Literal["openai", "anthropic", "openai_compat", "deepseek"]

VALID_PROVIDERS: tuple[LlmProvider, ...] = ("openai", "anthropic", "openai_compat", "deepseek")


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
    return [{"id": "openai"}, {"id": "anthropic"}, {"id": "openai_compat"}, {"id": "deepseek"}]
