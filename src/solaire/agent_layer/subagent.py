"""Isolated sub-agent run: shared tools, clean message stack, returns final text summary.

子任务不挂载主会话状态（session=None），避免污染计划模式 / 焦点 / 任务步骤；
工具集排除会话类与项目写入类能力。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable

from solaire.agent_layer.audit import append_audit
from solaire.agent_layer.compactor import summarize_tool_result
from solaire.agent_layer.context import tool_result_to_content
from solaire.agent_layer.guardrails import (
    SAFETY_MODE_VIVACE,
    check_tool_call,
    load_safety_mode,
    vivace_fast_review,
    vivace_needs_fast_model_review,
)
from solaire.agent_layer.llm.adapter import LLMAdapter
from solaire.agent_layer.models import GuardrailDecision, InvocationContext
from solaire.agent_layer.registry import (
    invoke_registered_tool,
    openai_tools_payload,
    tools_for_subagent,
)
from solaire.agent_layer.utils import parse_tool_arguments, tool_calls_signature


async def run_subagent(
    *,
    ctx: InvocationContext,
    objective: str,
    allowed_prefixes: list[str] | None,
    llm_chat: Callable[..., Awaitable[Any]],
    max_rounds: int = 8,
    emit: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    fast_adapter: LLMAdapter | None = None,
) -> str:
    """Run inner tool loop; return concise final answer for parent context."""
    tools = tools_for_subagent(allowed_prefixes=allowed_prefixes)
    otools = openai_tools_payload(tools)

    inner_ctx = ctx.model_copy(update={"subagent": True, "session": None})
    safety_mode = load_safety_mode(ctx.project_root)

    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": (
                "你是 SolEdu 子任务分析助手。在尽量少轮次内完成目标，"
                "仅输出最终结论，过程性说明保持简短。使用提供的工具获取事实数据。"
            ),
        },
        {"role": "user", "content": objective},
    ]

    repeat_count = 0
    last_tool_calls_sig = ""
    round_i = -1

    while True:
        round_i += 1
        resp = await llm_chat(messages, tools=otools, temperature=0.2)
        if resp.tool_calls:
            sig = tool_calls_signature(resp.tool_calls)
            if sig == last_tool_calls_sig:
                repeat_count += 1
            else:
                repeat_count = 0
                last_tool_calls_sig = sig
            if repeat_count >= max_rounds:
                return "（子任务检测到重复操作，已中止；请缩小目标后重试）"
            messages.append(
                {
                    "role": "assistant",
                    "content": resp.content,
                    "reasoning_content": getattr(resp, "reasoning_content", None) or "",
                    "tool_calls": resp.tool_calls,
                }
            )
            for tc in resp.tool_calls:
                fn = tc.get("function") or {}
                name = fn.get("name") or ""
                raw_args = fn.get("arguments") or "{}"
                args = parse_tool_arguments(raw_args)
                tid = tc.get("id") or f"sub-{round_i}"
                if emit:
                    await emit(
                        "tool_start",
                        {"tool_name": name, "arguments": args, "subagent": True, "round": round_i},
                    )
                dec = check_tool_call(name, args, inner_ctx, safety_mode=safety_mode)
                if dec != GuardrailDecision.AUTO_APPROVE:
                    msg = "子任务中该工具需确认，已中止；请回到主对话授权后重试。"
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tid,
                            "name": name,
                            "content": json.dumps({"error": msg}, ensure_ascii=False),
                        }
                    )
                    continue
                if (
                    dec == GuardrailDecision.AUTO_APPROVE
                    and safety_mode == SAFETY_MODE_VIVACE
                    and vivace_needs_fast_model_review(name)
                ):
                    if fast_adapter is None:
                        msg = "子任务中该操作需要安全复核，但未配置复核模型；请回到主对话执行或调整安全策略。"
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tid,
                                "name": name,
                                "content": json.dumps({"error": msg}, ensure_ascii=False),
                            }
                        )
                        continue
                    need_confirm, reason = await vivace_fast_review(
                        fast_adapter=fast_adapter, tool_name=name, args=args
                    )
                    if need_confirm:
                        msg = f"子任务中安全复核建议人工确认：{reason}。请回到主对话重试。"
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tid,
                                "name": name,
                                "content": json.dumps({"error": msg}, ensure_ascii=False),
                            }
                        )
                        continue
                tr = invoke_registered_tool(name, args, inner_ctx)
                payload = tr.data if tr.status == "succeeded" else {"error": tr.error_message}
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tid,
                        "name": name,
                        "content": tool_result_to_content(name, payload),
                    }
                )
                summ = summarize_tool_result(name, payload)
                if emit:
                    await emit(
                        "tool_result",
                        {
                            "tool_name": name,
                            "status": tr.status,
                            "summary": summ,
                            "subagent": True,
                            "round": round_i,
                        },
                    )
                append_audit(
                    ctx.project_root,
                    session_id=ctx.session_id,
                    tool_name=name,
                    status=tr.status,
                    detail={"subagent": True, "summary": summ},
                )
            continue
        text = (resp.content or "").strip()
        if text:
            return text[:8000]
        return "（子任务未产生文本结论）"


async def run_subagents_parallel(
    *,
    ctx: InvocationContext,
    objectives: list[str],
    allowed_prefixes: list[str] | None,
    llm_chat: Callable[..., Awaitable[Any]],
    max_rounds: int = 8,
    emit: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    fast_adapter: LLMAdapter | None = None,
) -> list[str]:
    """Run multiple isolated sub-agents concurrently; returns summaries in input order."""

    async def _one(obj: str) -> str:
        return await run_subagent(
            ctx=ctx,
            objective=obj,
            allowed_prefixes=allowed_prefixes,
            llm_chat=llm_chat,
            max_rounds=max_rounds,
            emit=emit,
            fast_adapter=fast_adapter,
        )

    return list(await asyncio.gather(*[_one(o) for o in objectives]))
