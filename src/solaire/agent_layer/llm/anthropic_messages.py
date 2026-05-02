"""Anthropic Messages API adapter (OpenAI-shaped tool_calls in / out for orchestrator)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from anthropic import AsyncAnthropic

from solaire.agent_layer.llm.adapter import ChatChunk, ChatResponse


def _split_system(messages: list[dict[str, Any]]) -> tuple[str | None, list[dict[str, Any]]]:
    sys_parts: list[str] = []
    rest: list[dict[str, Any]] = []
    for m in messages:
        if m.get("role") == "system":
            c = m.get("content")
            if isinstance(c, str) and c.strip():
                sys_parts.append(c.strip())
        else:
            rest.append(m)
    system = "\n\n".join(sys_parts) if sys_parts else None
    return system, rest


def _openai_tools_to_anthropic(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
    if not tools:
        return None
    out: list[dict[str, Any]] = []
    for t in tools:
        fn = t.get("function") or {}
        name = fn.get("name")
        if not name:
            continue
        schema = fn.get("parameters") or {"type": "object", "properties": {}}
        out.append(
            {
                "name": name,
                "description": fn.get("description") or "",
                "input_schema": schema,
            }
        )
    return out or None


def _build_anthropic_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    i = 0
    n = len(messages)
    while i < n:
        m = messages[i]
        role = m.get("role")
        if role == "user":
            c = m.get("content")
            out.append({"role": "user", "content": [{"type": "text", "text": str(c or "")}]})
            i += 1
            continue
        if role == "assistant":
            blocks: list[dict[str, Any]] = []
            content = m.get("content")
            if content:
                blocks.append({"type": "text", "text": str(content)})
            for tc in m.get("tool_calls") or []:
                fn = tc.get("function") or {}
                raw_args = fn.get("arguments") or "{}"
                try:
                    inp = json.loads(raw_args)
                except json.JSONDecodeError:
                    inp = {}
                if not isinstance(inp, dict):
                    inp = {}
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": str(tc.get("id") or ""),
                        "name": str(fn.get("name") or ""),
                        "input": inp,
                    }
                )
            out.append({"role": "assistant", "content": blocks})
            i += 1
            continue
        if role == "tool":
            tresults: list[dict[str, Any]] = []
            while i < n and messages[i].get("role") == "tool":
                tm = messages[i]
                tresults.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": str(tm.get("tool_call_id") or ""),
                        "content": str(tm.get("content") or ""),
                    }
                )
                i += 1
            out.append({"role": "user", "content": tresults})
            continue
        i += 1
    return out


def _anthropic_response_to_chat(resp: Any) -> ChatResponse:
    text_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    reasoning: str | None = None
    for block in resp.content:
        btype = getattr(block, "type", None)
        if btype == "text":
            text_parts.append(getattr(block, "text", "") or "")
        elif btype == "thinking":
            reasoning = (reasoning or "") + (getattr(block, "thinking", None) or "")
        elif btype == "tool_use":
            inp = getattr(block, "input", None) or {}
            tool_calls.append(
                {
                    "id": block.id,
                    "type": "function",
                    "function": {
                        "name": block.name,
                        "arguments": json.dumps(inp, ensure_ascii=False) if isinstance(inp, dict) else "{}",
                    },
                }
            )
    content = "".join(text_parts) if text_parts else None
    sr = getattr(resp, "stop_reason", None)
    if sr == "tool_use":
        finish_reason = "tool_calls"
    elif sr == "max_tokens":
        finish_reason = "length"
    else:
        finish_reason = "stop"
    usage: dict[str, int] = {}
    u = getattr(resp, "usage", None)
    if u is not None:
        usage = {
            "prompt_tokens": int(getattr(u, "input_tokens", None) or 0),
            "completion_tokens": int(getattr(u, "output_tokens", None) or 0),
            "total_tokens": int(getattr(u, "input_tokens", None) or 0) + int(getattr(u, "output_tokens", None) or 0),
        }
        cr = getattr(u, "cache_read_input_tokens", None)
        if cr is not None:
            usage["prompt_cache_hit_tokens"] = int(cr or 0)
        cc = getattr(u, "cache_creation_input_tokens", None)
        if cc is not None:
            usage["prompt_cache_write_tokens"] = int(cc or 0)
    return ChatResponse(
        content=content,
        reasoning_content=reasoning,
        tool_calls=tool_calls,
        finish_reason=finish_reason,
        usage=usage,
    )


class AnthropicMessagesAdapter:
    def __init__(self, *, api_key: str | None, base_url: str | None, model: str) -> None:
        self.model = model
        kwargs: dict[str, Any] = {}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        self._client = AsyncAnthropic(**kwargs)

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
        system, rest = _split_system(messages)
        amsg = _build_anthropic_messages(rest)
        atools = _openai_tools_to_anthropic(tools)
        mt = max_tokens if max_tokens is not None else 4096
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": mt,
            "messages": amsg,
            "temperature": temperature,
        }
        if system:
            kwargs["system"] = system
        if atools:
            kwargs["tools"] = atools
            kwargs["tool_choice"] = {"type": "auto"}
        resp = await self._client.messages.create(**kwargs)
        return _anthropic_response_to_chat(resp)

    async def chat_stream_text(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]:
        system, rest = _split_system(messages)
        amsg = _build_anthropic_messages(rest)
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": amsg,
            "temperature": temperature,
            "stream": True,
        }
        if system:
            kwargs["system"] = system
        stream = await self._client.messages.create(**kwargs)
        async for event in stream:
            if getattr(event, "type", None) == "content_block_delta":
                delta = event.delta
                if getattr(delta, "type", None) == "text_delta":
                    t = getattr(delta, "text", None)
                    if t:
                        yield t

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        max_tokens: int | None = None,
    ) -> AsyncIterator[ChatChunk]:
        system, rest = _split_system(messages)
        amsg = _build_anthropic_messages(rest)
        atools = _openai_tools_to_anthropic(tools)
        mt = max_tokens if max_tokens is not None else 4096
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": mt,
            "messages": amsg,
            "temperature": temperature,
            "stream": True,
        }
        if system:
            kwargs["system"] = system
        if atools:
            kwargs["tools"] = atools
            kwargs["tool_choice"] = {"type": "auto"}
        stream = await self._client.messages.create(**kwargs)

        reasoning_buf = ""
        async for event in stream:
            et = getattr(event, "type", None)
            if et == "content_block_delta":
                delta = event.delta
                dt = getattr(delta, "type", None)
                if dt == "text_delta":
                    piece = getattr(delta, "text", None) or ""
                    if piece:
                        yield ChatChunk(delta_content=piece)
                elif dt == "thinking_delta":
                    piece = getattr(delta, "thinking", None) or ""
                    reasoning_buf += str(piece)
                    if piece:
                        yield ChatChunk(delta_reasoning=str(piece))

        final = await stream.get_final_message()
        chat_resp = _anthropic_response_to_chat(final)
        assembled = list(chat_resp.tool_calls)
        u = chat_resp.usage
        fr = chat_resp.finish_reason or "stop"
        if fr == "length" and mt and u is not None:
            ct = int(u.get("completion_tokens") or 0)
            if ct < mt and not assembled:
                fr = "stop"

        yield ChatChunk(
            finish_reason=fr,
            raw_tool_calls=assembled,
            usage=u if u else None,
            accumulated_reasoning=reasoning_buf or chat_resp.reasoning_content or None,
        )
