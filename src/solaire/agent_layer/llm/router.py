"""Model routing from environment variables and optional project overrides."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from solaire.agent_layer.llm.llm_overrides import load_overrides_raw
from solaire.agent_layer.llm.openai_compat import OpenAICompatAdapter
from solaire.agent_layer.llm.providers import (
    LlmProvider,
    normalize_provider,
    provider_default_base_url,
    provider_default_models,
)
from solaire.agent_layer.llm.user_llm_overrides import load_user_overrides_raw


def _merge_override_dict(
    ov: dict[str, str],
    *,
    api_key: str | None,
    base_url: str | None,
    provider: LlmProvider,
    main_model: str,
    fast_model: str,
    max_tokens: int | None,
) -> tuple[str | None, str | None, LlmProvider, str, str, int | None]:
    if ov.get("api_key"):
        api_key = ov["api_key"]
    if "base_url" in ov:
        base_url = ov["base_url"] or None
    if ov.get("provider"):
        provider = normalize_provider(ov["provider"])
    if ov.get("main_model"):
        main_model = ov["main_model"]
    if ov.get("fast_model"):
        fast_model = ov["fast_model"]
    if ov.get("max_tokens") is not None and str(ov["max_tokens"]).strip() != "":
        try:
            max_tokens = int(ov["max_tokens"])
        except (ValueError, TypeError):
            pass
    return api_key, base_url, provider, main_model, fast_model, max_tokens


def _env_api_key_for_provider(provider: LlmProvider) -> str | None:
    k = os.environ.get("SOLAIRE_LLM_API_KEY")
    if k:
        return k
    if provider == "anthropic":
        k = os.environ.get("ANTHROPIC_API_KEY")
        if k:
            return k
    if provider == "deepseek":
        k = os.environ.get("DEEPSEEK_API_KEY")
        if k:
            return k
    return os.environ.get("OPENAI_API_KEY")


@dataclass
class LLMSettings:
    api_key: str | None
    base_url: str | None
    provider: LlmProvider
    main_model: str
    fast_model: str
    max_tokens: int | None = None
    temperature: float = 0.3


def load_llm_settings(project_root: Path | None = None) -> LLMSettings:
    provider = normalize_provider(os.environ.get("SOLAIRE_LLM_PROVIDER"))
    api_key = _env_api_key_for_provider(provider)
    base_url = os.environ.get("SOLAIRE_LLM_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
    main_def, fast_def = provider_default_models(provider)
    main_model = os.environ.get("SOLAIRE_LLM_MODEL", main_def)
    fast_model = os.environ.get(
        "SOLAIRE_LLM_FAST_MODEL",
        os.environ.get("SOLAIRE_LLM_MODEL", fast_def),
    )

    max_tokens_str = os.environ.get("SOLAIRE_LLM_MAX_TOKENS")
    max_tokens: int | None = int(max_tokens_str) if max_tokens_str and max_tokens_str.isdigit() else None

    temperature_str = os.environ.get("SOLAIRE_LLM_TEMPERATURE")
    temperature: float = float(temperature_str) if temperature_str else 0.3

    user_ov = load_user_overrides_raw()
    api_key, base_url, provider, main_model, fast_model, max_tokens = _merge_override_dict(
        user_ov,
        api_key=api_key,
        base_url=base_url,
        provider=provider,
        main_model=main_model,
        fast_model=fast_model,
        max_tokens=max_tokens,
    )
    if project_root is not None:
        proj_ov = load_overrides_raw(project_root)
        api_key, base_url, provider, main_model, fast_model, max_tokens = _merge_override_dict(
            proj_ov,
            api_key=api_key,
            base_url=base_url,
            provider=provider,
            main_model=main_model,
            fast_model=fast_model,
            max_tokens=max_tokens,
        )

    if provider == "deepseek" and not base_url:
        base_url = provider_default_base_url("deepseek")

    if max_tokens is None:
        max_tokens = 4096

    return LLMSettings(
        api_key=api_key,
        base_url=base_url,
        provider=provider,
        main_model=main_model,
        fast_model=fast_model,
        max_tokens=max_tokens,
        temperature=temperature,
    )


class ModelRouter:
    def __init__(self, settings: LLMSettings | None = None, *, project_root: Path | None = None) -> None:
        if settings is not None:
            self.settings = settings
        else:
            self.settings = load_llm_settings(project_root)

    def main(self) -> Any:
        return _build_adapter(
            api_key=self.settings.api_key,
            base_url=self.settings.base_url,
            model=self.settings.main_model,
            provider=self.settings.provider,
        )

    def fast(self) -> Any:
        return _build_adapter(
            api_key=self.settings.api_key,
            base_url=self.settings.base_url,
            model=self.settings.fast_model,
            provider=self.settings.provider,
        )


def _openai_compat_deepseek_mode(provider: LlmProvider, base_url: str | None) -> bool:
    """DeepSeek 官方 OpenAI 兼容：须带 thinking extra_body，且不宜发 parallel_tool_calls 等未声明扩展。"""
    if provider == "deepseek":
        return True
    if base_url and "deepseek.com" in base_url.lower():
        return True
    return False


def _build_adapter(
    *,
    api_key: str | None,
    base_url: str | None,
    model: str,
    provider: LlmProvider,
) -> Any:
    from solaire.agent_layer.llm.anthropic_messages import AnthropicMessagesAdapter
    from solaire.agent_layer.llm.openai_responses import OpenAIResponsesAdapter

    if provider == "openai":
        return OpenAIResponsesAdapter(api_key=api_key, base_url=base_url, model=model)
    if provider == "anthropic":
        return AnthropicMessagesAdapter(api_key=api_key, base_url=base_url, model=model)
    return OpenAICompatAdapter(
        api_key=api_key,
        base_url=base_url,
        model=model,
        deepseek_compat=_openai_compat_deepseek_mode(provider, base_url),
    )
