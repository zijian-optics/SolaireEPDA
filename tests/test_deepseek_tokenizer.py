"""DeepSeek tokenizer path + context estimate helpers."""

from __future__ import annotations

from solaire.agent_layer.llm.deepseek_tokenizer import (
    DEEPSEEK_PUBLIC_CONTEXT_LIMIT,
    context_limit_for_provider,
    estimate_context_prompt_tokens,
    estimate_deepseek_messages_tokens,
)


def test_context_limit_for_deepseek_provider() -> None:
    assert context_limit_for_provider("deepseek", None) == DEEPSEEK_PUBLIC_CONTEXT_LIMIT
    assert context_limit_for_provider("openai_compat", "https://api.deepseek.com/v1") == DEEPSEEK_PUBLIC_CONTEXT_LIMIT
    assert context_limit_for_provider("openai_compat", "https://example.com") is None


def test_estimate_context_prompt_tokens_positive_for_deepseek() -> None:
    msgs = [{"role": "user", "content": "hello " * 80}]
    n = estimate_context_prompt_tokens("deepseek", "https://api.deepseek.com", msgs)
    assert n > 10


def test_estimate_deepseek_messages_tokens_when_tokenizer_available() -> None:
    msgs = [{"role": "user", "content": "ping"}]
    direct = estimate_deepseek_messages_tokens(msgs)
    # 仓库内 tokenizer.json 存在时应返回正整数；否则为 None（由 estimate_context_prompt_tokens 回退）
    if direct is not None:
        assert direct >= 1
