"""OpenAI Responses API adapter (aligned with Chat interface expected by orchestrator)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI

from solaire.agent_layer.llm.adapter import ChatChunk, ChatResponse


def _tools_for_responses(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
    if not tools:
        return None
    out: list[dict[str, Any]] = []
    for t in tools:
        fn = t.get("function") or {}
        name = fn.get("name")
        if not name:
            continue
        out.append(
            {
                "type": "function",
                "name": name,
                "description": fn.get("description"),
                "parameters": fn.get("parameters") or {"type": "object", "properties": {}},
            }
        )
    return out or None


def _messages_to_responses_input(
    messages: list[dict[str, Any]],
) -> tuple[str | None, list[dict[str, Any]]]:
    """Split Chat-style messages into Responses ``instructions`` + ``input`` items."""
    instructions_parts: list[str] = []
    input_items: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role")
        if role == "system":
            c = m.get("content")
            if isinstance(c, str) and c.strip():
                instructions_parts.append(c.strip())
            continue
        if role == "user":
            content = m.get("content")
            if not isinstance(content, str):
                content = str(content or "")
            input_items.append({"type": "message", "role": "user", "content": content})
            continue
        if role == "assistant":
            raw_c = m.get("content")
            content = raw_c if isinstance(raw_c, str) else (str(raw_c) if raw_c is not None else "")
            tcs = m.get("tool_calls") or []
            if content.strip():
                input_items.append({"type": "message", "role": "assistant", "content": content})
            elif not tcs:
                input_items.append({"type": "message", "role": "assistant", "content": ""})
            for tc in tcs:
                fn = tc.get("function") or {}
                cid = tc.get("id") or tc.get("call_id") or ""
                input_items.append(
                    {
                        "type": "function_call",
                        "call_id": cid,
                        "name": fn.get("name") or "",
                        "arguments": fn.get("arguments") or "{}",
                    }
                )
            continue
        if role == "tool":
            input_items.append(
                {
                    "type": "function_call_output",
                    "call_id": m.get("tool_call_id") or "",
                    "output": m.get("content") or "",
                }
            )
            continue
    instructions = "\n\n".join(instructions_parts) if instructions_parts else None
    return instructions, input_items


def _parse_response_output(resp: Any) -> tuple[str | None, str | None, list[dict[str, Any]], str, dict[str, int]]:
    text_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    reasoning_parts: list[str] = []
    for item in resp.output or []:
        itype = getattr(item, "type", None)
        if itype == "message":
            for part in getattr(item, "content", None) or []:
                ptype = getattr(part, "type", None)
                if ptype == "output_text":
                    text_parts.append(getattr(part, "text", "") or "")
                # reasoning may appear as output item in some models
        elif itype == "reasoning":
            s = getattr(item, "summary", None) or []
            for b in s or []:
                if getattr(b, "type", None) == "summary_text":
                    reasoning_parts.append(getattr(b, "text", "") or "")
        elif itype == "function_call":
            tool_calls.append(
                {
                    "id": item.call_id,
                    "type": "function",
                    "function": {
                        "name": item.name,
                        "arguments": item.arguments or "{}",
                    },
                }
            )
    content = "".join(text_parts) if text_parts else None
    reasoning = "".join(reasoning_parts) if reasoning_parts else None
    finish_reason = "stop"
    if tool_calls:
        finish_reason = "tool_calls"
    inc = getattr(resp, "incomplete_details", None)
    if inc is not None and getattr(inc, "reason", None) == "max_output_tokens":
        finish_reason = "length"
    usage: dict[str, int] = {}
    u = getattr(resp, "usage", None)
    if u is not None:
        usage = {
            "prompt_tokens": int(getattr(u, "input_tokens", None) or 0),
            "completion_tokens": int(getattr(u, "output_tokens", None) or 0),
            "total_tokens": int(getattr(u, "total_tokens", None) or 0),
        }
        details = getattr(u, "input_tokens_details", None) or getattr(u, "prompt_tokens_details", None)
        if details is not None:
            ct = getattr(details, "cached_tokens", None)
            if ct is not None:
                usage["prompt_cache_hit_tokens"] = int(ct or 0)
            # Responses：未命中缓存部分常落在 input_tokens − cached
            inp = usage.get("prompt_tokens", 0)
            hit = usage.get("prompt_cache_hit_tokens", 0)
            if int(inp) > int(hit):
                usage["prompt_cache_miss_tokens"] = int(inp) - int(hit)
    return content, reasoning, tool_calls, finish_reason, usage


class OpenAIResponsesAdapter:
    def __init__(self, *, api_key: str | None, base_url: str | None, model: str) -> None:
        self.model = model
        kwargs: dict[str, Any] = {}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        self._client = AsyncOpenAI(**kwargs)

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
        instructions, input_items = _messages_to_responses_input(messages)
        req: dict[str, Any] = {
            "model": self.model,
            "input": input_items,
            "temperature": temperature,
            "parallel_tool_calls": True,
        }
        if instructions:
            req["instructions"] = instructions
        if max_tokens is not None:
            req["max_output_tokens"] = max_tokens
        rtools = _tools_for_responses(tools)
        if rtools:
            req["tools"] = rtools
            req["tool_choice"] = "auto"
        resp = await self._client.responses.create(**req)
        content, reasoning, tool_calls, finish_reason, usage = _parse_response_output(resp)
        return ChatResponse(
            content=content,
            reasoning_content=reasoning,
            tool_calls=tool_calls,
            finish_reason=finish_reason,
            usage=usage,
        )

    async def chat_stream_text(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]:
        instructions, input_items = _messages_to_responses_input(messages)
        req: dict[str, Any] = {
            "model": self.model,
            "input": input_items,
            "temperature": temperature,
            "stream": True,
        }
        if instructions:
            req["instructions"] = instructions
        stream = await self._client.responses.create(**req)
        async for event in stream:
            et = getattr(event, "type", None)
            if et == "response.output_text.delta":
                d = getattr(event, "delta", None)
                if d:
                    yield d

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        max_tokens: int | None = None,
    ) -> AsyncIterator[ChatChunk]:
        instructions, input_items = _messages_to_responses_input(messages)
        req: dict[str, Any] = {
            "model": self.model,
            "input": input_items,
            "temperature": temperature,
            "parallel_tool_calls": True,
            "stream": True,
        }
        if instructions:
            req["instructions"] = instructions
        if max_tokens is not None:
            req["max_output_tokens"] = max_tokens
        rtools = _tools_for_responses(tools)
        if rtools:
            req["tools"] = rtools
            req["tool_choice"] = "auto"
        try:
            req["stream_options"] = {"include_usage": True}
            stream = await self._client.responses.create(**req)
        except TypeError:
            req.pop("stream_options", None)
            stream = await self._client.responses.create(**req)

        reasoning_buf = ""
        usage: dict[str, int] | None = None
        final_resp: Any | None = None

        async for event in stream:
            et = getattr(event, "type", None)
            if et == "response.output_text.delta":
                d = getattr(event, "delta", None)
                if d:
                    yield ChatChunk(delta_content=d)
            elif et == "response.reasoning_text.delta":
                d = getattr(event, "delta", None)
                if d:
                    piece = str(d)
                    reasoning_buf += piece
                    yield ChatChunk(delta_reasoning=piece)
            elif et == "response.completed":
                final_resp = getattr(event, "response", None)

        if final_resp is not None:
            _c, _r, tool_calls, finish_reason, u = _parse_response_output(final_resp)
            if u:
                usage = u
            fr = finish_reason
            if fr == "stop" and max_tokens and usage is not None:
                ct = int(usage.get("completion_tokens") or 0)
                if ct >= max_tokens:
                    fr = "length"
            yield ChatChunk(
                finish_reason=fr,
                raw_tool_calls=tool_calls,
                usage=usage,
                accumulated_reasoning=reasoning_buf or None,
            )
        else:
            yield ChatChunk(
                finish_reason="stop",
                raw_tool_calls=[],
                usage=usage,
                accumulated_reasoning=reasoning_buf or None,
            )
