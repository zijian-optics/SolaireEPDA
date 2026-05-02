"""Draft tool-call loop: parallel read batch, subagent, guardrails, confirmations."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from solaire.agent_layer.audit import append_audit
from solaire.agent_layer.cancel_signal import clear_cancel, is_cancelled
from solaire.agent_layer.compactor import summarize_tool_result
from solaire.agent_layer.context import tool_result_to_content
from solaire.agent_layer.guardrails import (
    SAFETY_MODE_VIVACE,
    check_tool_call,
    human_confirmation_message,
    vivace_fast_review,
    vivace_needs_fast_model_review,
)
from solaire.agent_layer.llm.adapter import LLMAdapter
from solaire.agent_layer.models import (
    ChatMessage,
    GuardrailDecision,
    InvocationContext,
    PendingConfirmation,
    SessionState,
    ToolResult,
    ToolRisk,
)
from solaire.agent_layer.registry import (
    SUBTASK_TOOL_NAME,
    get_registered_tool,
    invoke_registered_tool,
)
from solaire.agent_layer.session import save_session
from solaire.agent_layer.subagent import run_subagent
from solaire.agent_layer.tools import analysis_tools
from solaire.agent_layer.tools.tool_definitions import RegisteredTool
from solaire.agent_layer.tool_validator import validate_tool_call
from solaire.agent_layer.utils import parse_tool_arguments as _parse_args

logger = logging.getLogger(__name__)

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]


@dataclass
class DraftToolContext:
    """Bundle of context needed to execute a tool-call draft loop."""
    project_root: Path
    session: SessionState
    ctx: InvocationContext
    safety_mode: str
    adapter: LLMAdapter
    fast_adapter: LLMAdapter
    emit: EmitFn
    tools: list[RegisteredTool] | None = None  # current turn's selected tools (for validation)


def flush_draft_to_messages(session: SessionState) -> None:
    d = session.draft_assistant
    if not d:
        session.draft_tool_results = []
        return
    tcs = d.get("tool_calls") or []
    results = session.draft_tool_results
    rc = d.get("reasoning_content")
    if tcs and rc is None:
        rc = ""
    session.messages.append(
        ChatMessage(
            role="assistant",
            content=d.get("content"),
            reasoning_content=rc,
            tool_calls=list(tcs),
        )
    )
    for tr in results:
        session.messages.append(
            ChatMessage(
                role="tool",
                content=tr.get("content", ""),
                tool_call_id=tr.get("tool_call_id"),
                name=tr.get("name"),
            )
        )
    session.draft_assistant = None
    session.draft_tool_results = []
    session.touch()


def consecutive_read_tool_indices(
    tcs: list[dict[str, Any]],
    start: int,
    ctx: InvocationContext,
    safety_mode: str,
) -> list[int]:
    indices: list[int] = []
    j = start
    while j < len(tcs):
        tc = tcs[j]
        fn = tc.get("function") or {}
        name = fn.get("name") or ""
        if name == SUBTASK_TOOL_NAME:
            break
        rt = get_registered_tool(name)
        if not rt or rt.risk != ToolRisk.READ:
            break
        args, _ = _parse_args(fn.get("arguments"))
        dec = check_tool_call(name, args, ctx, safety_mode=safety_mode)
        if dec != GuardrailDecision.AUTO_APPROVE:
            break
        indices.append(j)
        j += 1
    return indices


def consecutive_subtask_tool_indices(
    tcs: list[dict[str, Any]],
    start: int,
    ctx: InvocationContext,
    safety_mode: str,
) -> list[int]:
    """Collect consecutive agent.run_subtask calls that are all auto-approved (for parallel run)."""
    indices: list[int] = []
    j = start
    while j < len(tcs):
        tc = tcs[j]
        fn = tc.get("function") or {}
        name = fn.get("name") or ""
        if name != SUBTASK_TOOL_NAME:
            break
        args, _ = _parse_args(fn.get("arguments"))
        dec = check_tool_call(name, args, ctx, safety_mode=safety_mode)
        if dec != GuardrailDecision.AUTO_APPROVE:
            break
        indices.append(j)
        j += 1
    return indices


def thinking_label_for_tool(tool_name: str) -> str:
    rt = get_registered_tool(tool_name)
    if rt and rt.ui_label:
        return rt.ui_label
    return "正在执行操作…"


def _build_tool_result_dict(tid: str, name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Pack a validated tool result into the dict stored in session.draft_tool_results."""
    return {
        "tool_call_id": tid,
        "name": name,
        "content": tool_result_to_content(name, payload),
    }


async def _post_tool_events(
    *,
    emit: EmitFn,
    project_root: Path,
    session_id: str,
    name: str,
    tid: str,
    status: str,
    payload: dict[str, Any],
    ctx: InvocationContext,
    extra_detail: dict[str, Any] | None = None,
) -> None:
    """Emit tool_result, append audit, emit task_update if needed (shared by all paths)."""
    detail = {"summary": summarize_tool_result(name, payload)}
    if extra_detail:
        detail.update(extra_detail)
    append_audit(project_root, session_id=session_id, tool_name=name, status=status, detail=detail)
    await emit("tool_result", {
        "tool_name": name,
        "status": status,
        "summary": summarize_tool_result(name, payload),
    })
    if ctx.session and name in ("agent.set_task_plan", "agent.update_task_step"):
        await emit("task_update", {"steps": list(ctx.session.task_plan)})


async def _execute_single_tool(
    *,
    dtc: DraftToolContext,
    tc: dict[str, Any],
    index: int,
    skip_guardrails: bool = False,
) -> tuple[bool, dict[str, Any] | None]:
    """Execute one tool call with full validation + guardrails + execution.

    Returns (stopped_for_confirmation, tool_result_dict_or_None).
    When stopped_for_confirmation is True, the caller must exit the loop.
    When the tool is skipped (e.g. syntax error), returns (False, None) and
    the result is already appended to session.draft_tool_results by this function.
    The caller only appends when (False, result_dict) is returned.
    """
    session = dtc.session
    ctx = dtc.ctx
    safety_mode = dtc.safety_mode
    emit = dtc.emit
    sid = session.session_id
    project_root = dtc.project_root

    fn = tc.get("function") or {}
    raw_name = fn.get("name") or ""
    raw_args = fn.get("arguments")
    tid = tc.get("id") or f"call-{index}"

    # --- Stage 1: Validate ---
    available = dtc.tools or []
    validated = validate_tool_call(raw_name, raw_args, available)
    name = validated.tool_name
    args = validated.arguments

    if not validated.is_valid:
        error_payload = {"error": validated.error_message, "error_code": validated.error_code}
        if validated.suggestion:
            error_payload["suggestion"] = validated.suggestion
        result = _build_tool_result_dict(tid, name, error_payload)
        session.draft_tool_results.append(result)
        await _post_tool_events(
            emit=emit, project_root=project_root, session_id=sid,
            name=name, tid=tid, status="failed", payload=error_payload, ctx=ctx,
        )
        return False, None

    # --- Stage 2: Emit start ---
    await emit("thinking", {"message": thinking_label_for_tool(name)})
    await emit("tool_start", {"tool_name": name, "arguments": args})

    # --- Stage 3: Subagent ---
    if name == SUBTASK_TOOL_NAME:
        objective = str(args.get("objective") or "")
        pfx = args.get("allowed_tool_prefixes")
        prefixes = [str(x) for x in pfx] if isinstance(pfx, list) else None

        async def sub_emit(ev: str, data: dict[str, Any]) -> None:
            await emit(ev, data)

        await emit("subagent_start", {"task_description": objective[:500]})
        summary = await run_subagent(
            ctx=ctx, objective=objective, allowed_prefixes=prefixes,
            llm_chat=dtc.adapter.chat, max_rounds=ctx.max_subagent_tool_rounds,
            emit=sub_emit, fast_adapter=dtc.fast_adapter,
        )
        await emit("subagent_done", {"summary": summary[:2000]})
        payload = {"tool": name, "result": {"summary": summary}}
        result = _build_tool_result_dict(tid, name, payload)
        session.draft_tool_results.append(result)
        await _post_tool_events(
            emit=emit, project_root=project_root, session_id=sid,
            name=name, tid=tid, status="succeeded", payload=payload, ctx=ctx,
            extra_detail={"subagent": True},
        )
        return False, result

    # --- Stage 4: Guardrails (skip for pre-approved batch reads) ---
    if not skip_guardrails:
        dec = check_tool_call(name, args, ctx, safety_mode=safety_mode)
        confirm_extra = ""
        if dec == GuardrailDecision.AUTO_APPROVE and safety_mode == SAFETY_MODE_VIVACE and vivace_needs_fast_model_review(name):
            need_confirm, reason = await vivace_fast_review(
                fast_adapter=dtc.fast_adapter, tool_name=name, args=args,
            )
            if need_confirm:
                dec = GuardrailDecision.NEEDS_CONFIRMATION
                confirm_extra = f"（安全复核提示：{reason}）"
                await emit("thinking", {"message": f"已触发安全复核：{reason}"})
        if dec != GuardrailDecision.AUTO_APPROVE:
            aid = uuid.uuid4().hex
            session.pending_confirmations[aid] = PendingConfirmation(
                tool_call_id=tid, tool_name=name, arguments=args,
                description=human_confirmation_message(name, args) + confirm_extra,
            )
            await emit("confirm_needed", {
                "action_id": aid, "tool_name": name,
                "description": session.pending_confirmations[aid].description,
                "risk": "write_or_destructive",
            })
            save_session(project_root, session)
            await emit("done", {"usage": {}, "awaiting_confirmation": True})
            return True, None

    # --- Stage 5: Pre-execution checks ---
    if name == "analysis.save_script" and args.get("code"):
        ok, err = analysis_tools.validate_python_syntax(str(args["code"]))
        if not ok:
            error_payload = {"tool": name, "error": err}
            result = _build_tool_result_dict(tid, name, error_payload)
            session.draft_tool_results.append(result)
            return False, None

    # --- Stage 6: Execute ---
    tr = invoke_registered_tool(name, args, ctx)
    payload = tr.data if tr.status == "succeeded" else {"error": tr.error_message, "error_code": tr.error_code}
    result = _build_tool_result_dict(tid, name, payload)
    session.draft_tool_results.append(result)
    await _post_tool_events(
        emit=emit, project_root=project_root, session_id=sid,
        name=name, tid=tid, status=tr.status, payload=payload, ctx=ctx,
    )
    return False, result


async def run_draft_tool_loop(
    *,
    dtc: DraftToolContext,
) -> bool:
    """Returns True if stopped for confirmation or cancel."""
    session = dtc.session
    ctx = dtc.ctx
    safety_mode = dtc.safety_mode
    emit = dtc.emit
    project_root = dtc.project_root
    d = session.draft_assistant
    if not d:
        return False
    tcs = d.get("tool_calls") or []
    k = len(session.draft_tool_results)
    while k < len(tcs):
        if is_cancelled(session.session_id):
            clear_cancel(session.session_id)
            session.draft_assistant = None
            session.draft_tool_results = []
            await emit("error", {"code": "cancelled", "message": "已按您的操作停止。"})
            await emit("done", {"usage": {}, "cancelled": True})
            save_session(project_root, session)
            return True

        # --- Batch read tools (parallel, skip guardrails) ---
        read_batch = consecutive_read_tool_indices(tcs, k, ctx, safety_mode)
        if len(read_batch) >= 2:
            async def _invoke_read(i: int) -> tuple[int, str, str, Any]:
                tc_i = tcs[i]
                fn_i = tc_i.get("function") or {}
                raw_name = fn_i.get("name") or ""
                raw_args = fn_i.get("arguments")
                tid_i = tc_i.get("id") or f"call-{i}"
                # Pre-validate for batch reads
                available = dtc.tools or []
                validated = validate_tool_call(raw_name, raw_args, available)
                n = validated.tool_name
                a = validated.arguments
                if not validated.is_valid:
                    error_payload = {"error": validated.error_message, "error_code": validated.error_code}
                    if validated.suggestion:
                        error_payload["suggestion"] = validated.suggestion
                    return i, n, tid_i, ToolResult(status="failed", data=error_payload)
                tr_i = await asyncio.to_thread(invoke_registered_tool, n, a, ctx)
                return i, n, tid_i, tr_i

            for idx in read_batch:
                tc0 = tcs[idx]
                fn0 = tc0.get("function") or {}
                name0 = fn0.get("name") or ""
                args0, _ = _parse_args(fn0.get("arguments"))
                await emit("thinking", {"message": thinking_label_for_tool(name0)})
                await emit("tool_start", {"tool_name": name0, "arguments": args0})

            parts = await asyncio.gather(*[_invoke_read(i) for i in read_batch])
            for _i, name, tid, tr in sorted(parts, key=lambda x: x[0]):
                payload = tr.data if tr.status == "succeeded" else {"error": tr.error_message, "error_code": tr.error_code}
                result = _build_tool_result_dict(tid, name, payload)
                session.draft_tool_results.append(result)
                await _post_tool_events(
                    emit=emit, project_root=project_root, session_id=session.session_id,
                    name=name, tid=tid, status=tr.status, payload=payload, ctx=ctx,
                )
            k += len(read_batch)
            continue

        # --- Batch subtask tools (parallel) ---
        subtask_batch = consecutive_subtask_tool_indices(tcs, k, ctx, safety_mode)
        if len(subtask_batch) >= 2:
            for idx in subtask_batch:
                tc0 = tcs[idx]
                fn0 = tc0.get("function") or {}
                name0 = fn0.get("name") or ""
                args0, _ = _parse_args(fn0.get("arguments"))
                await emit("thinking", {"message": thinking_label_for_tool(name0)})
                await emit("tool_start", {"tool_name": name0, "arguments": args0})

            async def _run_subtask_one(i: int) -> tuple[int, str, str]:
                tc_i = tcs[i]
                fn_i = tc_i.get("function") or {}
                a, _ = _parse_args(fn_i.get("arguments"))
                tid_i = tc_i.get("id") or f"call-{i}"
                objective = str(a.get("objective") or "")
                pfx = a.get("allowed_tool_prefixes")
                prefixes = [str(x) for x in pfx] if isinstance(pfx, list) else None

                async def sub_emit(ev: str, data: dict[str, Any]) -> None:
                    await emit(ev, {**data, "parallel_subtask": True, "parallel_index": i})

                await emit("subagent_start", {
                    "task_description": objective[:500], "parallel_subtask": True, "parallel_index": i,
                })
                summary = await run_subagent(
                    ctx=ctx, objective=objective, allowed_prefixes=prefixes,
                    llm_chat=dtc.adapter.chat, max_rounds=ctx.max_subagent_tool_rounds,
                    emit=sub_emit, fast_adapter=dtc.fast_adapter,
                )
                return i, tid_i, summary

            parts = await asyncio.gather(*[_run_subtask_one(i) for i in subtask_batch])
            for i, tid_i, summary in sorted(parts, key=lambda x: x[0]):
                await emit("subagent_done", {"summary": summary[:2000], "parallel_subtask": True})
                payload = {"tool": SUBTASK_TOOL_NAME, "result": {"summary": summary}}
                result = _build_tool_result_dict(tid_i, SUBTASK_TOOL_NAME, payload)
                session.draft_tool_results.append(result)
                await _post_tool_events(
                    emit=emit, project_root=project_root, session_id=session.session_id,
                    name=SUBTASK_TOOL_NAME, tid=tid_i, status="succeeded", payload=payload, ctx=ctx,
                    extra_detail={"subagent": True, "parallel_subtask": True},
                )
            k += len(subtask_batch)
            continue

        # --- Single tool (full validation + guardrails) ---
        stopped, _result = await _execute_single_tool(dtc=dtc, tc=tcs[k], index=k, skip_guardrails=False)
        if stopped:
            return True
        k += 1

    flush_draft_to_messages(session)
    return False
