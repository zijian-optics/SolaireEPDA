"""OpenAI-compatible chat (async), tools + streaming for orchestrator."""

from __future__ import annotations

import copy
from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI

from solaire.agent_layer.llm.adapter import ChatChunk, ChatResponse
from solaire.agent_layer.llm.providers import ReasoningEffort


def _wire_to_canonical_tool_names() -> dict[str, str]:
    """实时从注册表构建 wire→canonical 映射，避免 lru_cache 在焦点切换后过期。"""
    from solaire.agent_layer.registry import _TOOL_BY_NAME

    return {name.replace(".", "_"): name for name in _TOOL_BY_NAME}


def _tool_name_wire_outbound(canonical: str) -> str:
    return canonical.replace(".", "_")


def _tool_name_wire_inbound(wire: str) -> str:
    if "." not in wire and "_" in wire:
        return _wire_to_canonical_tool_names().get(wire, wire)
    return wire


def _apply_tool_names_wire_outbound_messages(messages: list[dict[str, Any]]) -> None:
    for m in messages:
        if m.get("role") == "tool":
            nm = m.get("name")
            if isinstance(nm, str) and "." in nm:
                m["name"] = _tool_name_wire_outbound(nm)
            continue
        if m.get("role") != "assistant":
            continue
        tcs = m.get("tool_calls")
        if not tcs:
            continue
        for tc in tcs:
            fn = tc.get("function")
            if isinstance(fn, dict):
                nm = fn.get("name")
                if isinstance(nm, str) and "." in nm:
                    fn["name"] = _tool_name_wire_outbound(nm)


def _apply_tool_names_wire_outbound_tools(tools: list[dict[str, Any]]) -> None:
    for t in tools:
        fn = t.get("function")
        if not isinstance(fn, dict):
            continue
        nm = fn.get("name")
        if isinstance(nm, str) and "." in nm:
            fn["name"] = _tool_name_wire_outbound(nm)


def _map_raw_tool_calls_inbound(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for tc in raw:
        tc2 = copy.deepcopy(tc)
        fn = tc2.get("function")
        if isinstance(fn, dict):
            nm = fn.get("name")
            if isinstance(nm, str):
                fn["name"] = _tool_name_wire_inbound(nm)
        out.append(tc2)
    return out


def _prepare_compat_request_payload(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None]:
    """所有 OpenAI 兼容网关均转换工具名（'.' → '_'），满足 ^[a-zA-Z0-9_-]+$ 约束。"""
    m2 = copy.deepcopy(messages)
    t2 = copy.deepcopy(tools) if tools else None
    if t2:
        _apply_tool_names_wire_outbound_tools(t2)
    _apply_tool_names_wire_outbound_messages(m2)
    return m2, t2


from solaire.agent_layer.llm.message_utils import ensure_assistant_tool_calls_have_reasoning as _ensure_assistant_tool_calls_have_reasoning  # noqa: E501


class OpenAICompatAdapter:
    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str | None,
        model: str,
        deepseek_compat: bool = False,
        reasoning_effort: ReasoningEffort | None = None,
    ) -> None:
        self.model = model
        self._deepseek_compat = deepseek_compat
        self._reasoning_effort: ReasoningEffort | None = reasoning_effort
        kwargs: dict[str, Any] = {}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        self._client = AsyncOpenAI(**kwargs)

    def _apply_deepseek_openai_extensions(self, req: dict[str, Any]) -> None:
        """DeepSeek：思考模式 + 含工具调用的助手轮次须原样回传 `reasoning_content`。

        OpenAI Python SDK 在 `maybe_transform` 中按官方 TypedDict 裁剪 `messages`，会丢弃
        `reasoning_content`；请求体合并时 `extra_body`（extra_json）覆盖同名键，故在此放入
        完整 messages 副本。参见 DeepSeek 思考模式与工具调用说明。

        KV Cache 不影响 reasoning 回传：reasoning 在会话历史中按原样重放，是确定性的
        （存储时为定值），不破坏前缀匹配。详见 https://api-docs.deepseek.com/guides/kv_cache
        """
        if not self._deepseek_compat:
            return
        eb = dict(req.get("extra_body") or {})
        if "thinking" not in eb:
            eb["thinking"] = {"type": "enabled"}
        eb["messages"] = copy.deepcopy(req.get("messages") or [])
        req["extra_body"] = eb
        req.setdefault("reasoning_effort", self._reasoning_effort or "high")

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        max_tokens: int | None = None,
        stream: bool = False,
    ) -> ChatResponse:
        if stream:
            raise NotImplementedError("use chat_stream")
        messages_req, tools_req = _prepare_compat_request_payload(messages, tools)
        _ensure_assistant_tool_calls_have_reasoning(messages_req)
        req: dict[str, Any] = {
            "model": self.model,
            "messages": messages_req,
            "temperature": temperature,
        }
        if max_tokens is not None:
            req["max_tokens"] = max_tokens
        if tools_req:
            req["tools"] = tools_req
            req["tool_choice"] = "auto"
            if not self._deepseek_compat:
                req["parallel_tool_calls"] = True
        self._apply_deepseek_openai_extensions(req)
        try:
            resp = await self._client.chat.completions.create(**req)
        except TypeError:
            if self._deepseek_compat and "reasoning_effort" in req:
                req = {k: v for k, v in req.items() if k != "reasoning_effort"}
                resp = await self._client.chat.completions.create(**req)
            else:
                raise
        choice = resp.choices[0]
        msg = choice.message
        tool_calls: list[dict[str, Any]] = []
        if msg.tool_calls:
            for tc in msg.tool_calls:
                tool_calls.append(
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": _tool_name_wire_inbound(tc.function.name),
                            "arguments": tc.function.arguments or "{}",
                        },
                    }
                )
        usage: dict[str, int] = {}
        if resp.usage:
            usage = {
                "prompt_tokens": resp.usage.prompt_tokens or 0,
                "completion_tokens": resp.usage.completion_tokens or 0,
                "total_tokens": resp.usage.total_tokens or 0,
            }
            cache_hit = getattr(resp.usage, "prompt_cache_hit_tokens", None)
            if cache_hit is not None:
                usage["prompt_cache_hit_tokens"] = int(cache_hit or 0)
            cache_miss = getattr(resp.usage, "prompt_cache_miss_tokens", None)
            if cache_miss is not None:
                usage["prompt_cache_miss_tokens"] = int(cache_miss or 0)
        reasoning: str | None = None
        if msg is not None:
            raw_r = getattr(msg, "reasoning_content", None)
            if raw_r is None:
                raw_r = getattr(msg, "reasoning", None)
            if raw_r is not None:
                reasoning = str(raw_r)
        if tool_calls and reasoning is None:
            reasoning = ""
        return ChatResponse(
            content=msg.content,
            reasoning_content=reasoning,
            tool_calls=tool_calls,
            finish_reason=choice.finish_reason,
            usage=usage,
        )

    async def chat_stream_text(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.3,
    ):
        """Yield text deltas only (final assistant message without tools)."""
        stream = await self._client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            stream=True,
        )
        async for event in stream:
            if not event.choices:
                continue
            delta = event.choices[0].delta
            if delta.content:
                yield delta.content

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        max_tokens: int | None = None,
    ) -> AsyncIterator[ChatChunk]:
        """Stream completion; yields text chunks then one terminal chunk with finish_reason / tool_calls / usage."""
        messages_req, tools_req = _prepare_compat_request_payload(messages, tools)
        _ensure_assistant_tool_calls_have_reasoning(messages_req)
        req: dict[str, Any] = {
            "model": self.model,
            "messages": messages_req,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens is not None:
            req["max_tokens"] = max_tokens
        if tools_req:
            req["tools"] = tools_req
            req["tool_choice"] = "auto"
            if not self._deepseek_compat:
                req["parallel_tool_calls"] = True
        self._apply_deepseek_openai_extensions(req)
        try:
            if not self._deepseek_compat:
                req["stream_options"] = {"include_usage": True}
            stream = await self._client.chat.completions.create(**req)
        except TypeError:
            req.pop("stream_options", None)
            try:
                stream = await self._client.chat.completions.create(**req)
            except TypeError:
                if self._deepseek_compat and "reasoning_effort" in req:
                    req.pop("reasoning_effort", None)
                    stream = await self._client.chat.completions.create(**req)
                else:
                    raise

        tc_parts: dict[int, dict[str, str]] = {}
        finish_reason: str | None = None
        usage: dict[str, int] | None = None
        reasoning_buf = ""
        content_buf = ""

        async for event in stream:
            if getattr(event, "usage", None) is not None and event.usage is not None:
                u = event.usage
                usage = {
                    "prompt_tokens": getattr(u, "prompt_tokens", None) or 0,
                    "completion_tokens": getattr(u, "completion_tokens", None) or 0,
                    "total_tokens": getattr(u, "total_tokens", None) or 0,
                }
                cache_hit = getattr(u, "prompt_cache_hit_tokens", None)
                if cache_hit is not None:
                    usage["prompt_cache_hit_tokens"] = int(cache_hit or 0)
                cache_miss = getattr(u, "prompt_cache_miss_tokens", None)
                if cache_miss is not None:
                    usage["prompt_cache_miss_tokens"] = int(cache_miss or 0)
            if not event.choices:
                continue
            ch0 = event.choices[0]
            delta = ch0.delta
            if delta.content:
                content_buf += delta.content
                yield ChatChunk(delta_content=delta.content)
            dr = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
            if dr:
                piece = str(dr)
                reasoning_buf += piece
                yield ChatChunk(delta_reasoning=piece)
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = int(tc.index)
                    if idx not in tc_parts:
                        tc_parts[idx] = {"id": "", "name": "", "arguments": ""}
                    if getattr(tc, "id", None):
                        tc_parts[idx]["id"] = tc.id or tc_parts[idx]["id"]
                    fn = tc.function
                    if fn is not None:
                        if getattr(fn, "name", None):
                            tc_parts[idx]["name"] += fn.name or ""
                        if getattr(fn, "arguments", None):
                            tc_parts[idx]["arguments"] += fn.arguments or ""
            if ch0.finish_reason:
                finish_reason = ch0.finish_reason

        assembled: list[dict[str, Any]] = []
        for idx in sorted(tc_parts.keys()):
            p = tc_parts[idx]
            assembled.append(
                {
                    "id": p["id"] or f"call_{idx}",
                    "type": "function",
                    "function": {
                        "name": p["name"],
                        "arguments": p["arguments"] or "{}",
                    },
                }
            )

        assembled = _map_raw_tool_calls_inbound(assembled)

        raw_finish = finish_reason
        if assembled:
            fr = raw_finish or "tool_calls"
        else:
            fr = raw_finish or "stop"

        # 部分流式网关末包未带 finish_reason；若 usage 显示已达本次 max_tokens，按截断处理以便编排层续写
        if raw_finish is None and max_tokens and usage is not None:
            ct = int(usage.get("completion_tokens") or 0)
            if ct >= max_tokens:
                fr = "length"

        out_reasoning = reasoning_buf if reasoning_buf else ("" if assembled else None)

        yield ChatChunk(
            finish_reason=fr,
            raw_tool_calls=assembled,
            usage=usage,
            accumulated_reasoning=out_reasoning,
        )
