"""Agent turn orchestration: LLM loop, tools, confirmations, sub-agent, draft flush."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

from solaire.agent_layer.audit import append_audit
from solaire.agent_layer.cancel_signal import clear_cancel, is_cancelled
from solaire.agent_layer.compactor import summarize_tool_result
from solaire.agent_layer.context import ContextManager, tool_result_to_content
from solaire.agent_layer.guardrails import load_safety_mode, register_approval
from solaire.agent_layer.llm.router import ModelRouter, load_llm_settings
from solaire.agent_layer.history_writer import emit_memory_after_assistant_turn
from solaire.agent_layer.models import ChatMessage, InvocationContext, SessionState
from solaire.agent_layer.plan_document import (
    load_plan_steps_from_rel_path,
    normalize_rel_path,
    validate_agent_plan_rel_path,
)
from solaire.agent_layer.task_tracker import set_plan
from solaire.agent_layer.registry import (
    invoke_registered_tool,
    openai_tools_payload,
    select_tools_for_turn,
    tool_descriptions_for_prompt,
)
from solaire.agent_layer.session import save_session
from solaire.agent_layer.tools import analysis_tools
from solaire.agent_layer.tool_executor import run_draft_tool_loop
from solaire.agent_layer.utils import tool_calls_signature
from solaire.agent_layer.llm.token_budget import estimate_messages_tokens
from solaire.agent_layer.llm.prompt_cache import hash_text_sha12, hash_tools_payload_sha12
from solaire.agent_layer.prompts import build_dynamic_system_prompt, build_stable_system_prompt, build_tools_system_block

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]


def _thinking_for_round(round_idx: int) -> str:
    pool = (
        "正在理解您的问题…",
        "正在查找可用数据…",
        "正在准备下一步…",
        "正在继续处理…",
        "正在汇总信息…",
    )
    return pool[min(round_idx, len(pool) - 1)]


def _tool_calls_arguments_json_ok(tool_calls: list[dict[str, Any]]) -> bool:
    """Incomplete JSON often indicates tool_calls truncated by max_tokens (cf. Anthropic stop_reason guidance)."""
    for tc in tool_calls:
        raw = (tc.get("function") or {}).get("arguments") or "{}"
        try:
            json.loads(raw)
        except json.JSONDecodeError:
            return False
    return True


async def _llm_round_call(
    adapter: Any,
    api_messages: list[dict[str, Any]],
    tools_payload: list[dict[str, Any]],
    *,
    temperature: float,
    emit: EmitFn,
    max_tokens: int | None = None,
    _allow_tool_retry: bool = True,
) -> tuple[str, list[dict[str, Any]], dict[str, int], str, str]:
    """Returns (full_content, tool_calls, usage_delta, reasoning_content, finish_reason)."""
    usage_delta: dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    full_content = ""
    full_reasoning = ""
    tool_calls: list[dict[str, Any]] = []
    finish_reason = "stop"

    try:
        async for chunk in adapter.chat_stream(
            api_messages, tools=tools_payload, temperature=temperature, max_tokens=max_tokens
        ):
            if chunk.delta_content:
                full_content += chunk.delta_content
                await emit("text_delta", {"text": chunk.delta_content})
            if chunk.usage:
                for kk, vv in chunk.usage.items():
                    usage_delta[kk] = usage_delta.get(kk, 0) + int(vv or 0)
            if chunk.accumulated_reasoning is not None:
                full_reasoning = chunk.accumulated_reasoning
            if chunk.finish_reason is not None:
                tool_calls = list(chunk.raw_tool_calls or [])
                finish_reason = chunk.finish_reason
    except Exception:
        resp = await adapter.chat(
            api_messages, tools=tools_payload, temperature=temperature, max_tokens=max_tokens
        )
        full_content = (resp.content or "").strip()
        if full_content:
            await emit("text_delta", {"text": full_content})
        tool_calls = list(resp.tool_calls or [])
        fr = getattr(resp, "reasoning_content", None)
        full_reasoning = str(fr) if fr is not None else ""
        finish_reason = resp.finish_reason or "stop"
        for kk, vv in resp.usage.items():
            usage_delta[kk] = usage_delta.get(kk, 0) + int(vv or 0)

    if (
        _allow_tool_retry
        and max_tokens
        and finish_reason == "length"
        and tool_calls
        and not _tool_calls_arguments_json_ok(tool_calls)
    ):
        bump = min(int(max_tokens) * 2, 16384)
        if bump > max_tokens:
            return await _llm_round_call(
                adapter,
                api_messages,
                tools_payload,
                temperature=temperature,
                emit=emit,
                max_tokens=bump,
                _allow_tool_retry=False,
            )

    return full_content, tool_calls, usage_delta, full_reasoning, finish_reason


def _rebuild_tools(
    session: SessionState,
    current_page: str | None,
    skill_id: str | None,
    include_subtask: bool,
    project_root: Path | None = None,
) -> tuple[list[Any], list[dict[str, Any]]]:
    """Rebuild tool selection (e.g. after focus switch)."""
    tools_selected = select_tools_for_turn(
        current_page=current_page,
        skill_id=skill_id,
        include_subtask=include_subtask,
        current_focus=session.current_focus or None,
        project_root=project_root,
        plan_mode_active=session.plan_mode_active,
    )
    return tools_selected, openai_tools_payload(tools_selected)


async def run_agent_turn(
    project_root: Path,
    session: SessionState,
    *,
    user_message: str | None,
    project_ctx: dict[str, Any],
    mode: str = "execute",
    router: ModelRouter | None = None,
    confirm_action_id: str | None = None,
    confirm_accepted: bool | None = None,
    max_llm_rounds: int = 14,
    emit: EmitFn,
) -> None:
    """Run one user turn (or confirmation resume). Events via emit."""

    settings = load_llm_settings(project_root)
    rt = router or ModelRouter(settings=settings)
    adapter = rt.main()
    fast_adapter = rt.fast()
    safety_mode = load_safety_mode(project_root)
    max_tokens = settings.max_tokens
    ctx = InvocationContext(
        project_root=project_root,
        session_id=session.session_id,
        mode="suggest" if mode == "suggest" else "execute",
        session=session,
    )
    cm = ContextManager(include_subtask_tool=True)
    full_ctx = {**project_ctx, "_project_root": project_root}

    skill_id = project_ctx.get("_skill_id")
    if isinstance(skill_id, str):
        skill_id = skill_id.strip() or None
    else:
        skill_id = None
    pc = project_ctx.get("page_context")
    current_page: str | None = None
    if isinstance(pc, dict):
        cp = pc.get("current_page")
        current_page = str(cp) if cp else None

    from solaire.agent_layer import skills as skills_mod

    sk = skills_mod.get_skill(skill_id, project_root) if skill_id else None
    skill_guidance = sk.prompt_fragment if sk else None
    skill_catalog = skills_mod.build_skill_catalog(project_root)
    skip_memory_write = bool(project_ctx.get("_skip_memory_write"))

    raw_clear = project_ctx.get("_clear_pending_plan_path")
    if isinstance(raw_clear, str) and raw_clear.strip():
        cnorm = normalize_rel_path(raw_clear.strip())
        pend = session.pending_plan_path
        if pend and normalize_rel_path(pend) == cnorm:
            session.pending_plan_path = None
            session.execution_plan_path = None
            session.touch()

    raw_exec = project_ctx.get("_execution_plan_path")
    if isinstance(raw_exec, str) and raw_exec.strip():
        ep = normalize_rel_path(raw_exec.strip())
        if not ep:
            await emit("error", {"code": "invalid_plan", "message": "执行计划路径无效。"})
            save_session(project_root, session)
            await emit("done", {"usage": {}})
            return
        ok_plan, plan_err = validate_agent_plan_rel_path(project_root, ep)
        if not ok_plan:
            await emit("error", {"code": "invalid_plan", "message": plan_err})
            save_session(project_root, session)
            await emit("done", {"usage": {}})
            return
        pend = session.pending_plan_path
        if pend is None or normalize_rel_path(pend) != ep:
            await emit(
                "error",
                {
                    "code": "plan_not_approved",
                    "message": "请先在对话中生成计划，并在界面点击「执行」后再运行；若计划已变更请重新生成。",
                },
            )
            save_session(project_root, session)
            await emit("done", {"usage": {}})
            return
        session.execution_plan_path = ep
        steps = load_plan_steps_from_rel_path(project_root, ep)
        if steps:
            set_plan(session, steps)
            await emit("task_update", {"steps": list(session.task_plan)})
        session.touch()

    tools_selected = select_tools_for_turn(
        current_page=current_page,
        skill_id=skill_id,
        include_subtask=cm.include_subtask_tool,
        current_focus=session.current_focus or None,
        project_root=project_root,
        plan_mode_active=session.plan_mode_active,
    )
    tools_payload = openai_tools_payload(tools_selected)

    async def process_draft_loop() -> bool:
        return await run_draft_tool_loop(
            project_root=project_root,
            session=session,
            ctx=ctx,
            safety_mode=safety_mode,
            adapter=adapter,
            fast_adapter=fast_adapter,
            emit=emit,
        )

    # --- confirmation resume ---
    if confirm_action_id is not None:
        if confirm_accepted is None:
            confirm_accepted = True
        pending = session.pending_confirmations.pop(confirm_action_id, None)
        if pending is None:
            await emit("error", {"code": "unknown_action", "message": "无效或已过期的确认项"})
            save_session(project_root, session)
            await emit("done", {"usage": {}})
            return
        if confirm_accepted is False:
            await emit("text_delta", {"text": "已取消该操作。"})
            session.draft_assistant = None
            session.draft_tool_results = []
            save_session(project_root, session)
            await emit("done", {"usage": {}})
            return
        register_approval(session, ctx, pending.tool_name, pending.arguments)
        ran_ok = True
        if pending.tool_name == "analysis.save_script" and pending.arguments.get("code"):
            ok, err = analysis_tools.validate_python_syntax(str(pending.arguments["code"]))
            if not ok:
                ran_ok = False
                session.draft_tool_results.append(
                    {
                        "tool_call_id": pending.tool_call_id,
                        "name": pending.tool_name,
                        "content": json.dumps(
                            {"tool": pending.tool_name, "error": err},
                            ensure_ascii=False,
                        ),
                    }
                )
                append_audit(
                    project_root,
                    session_id=session.session_id,
                    tool_name=pending.tool_name,
                    status="failed",
                    detail={"confirmed": True, "syntax": err},
                )
                await emit(
                    "tool_result",
                    {
                        "tool_name": pending.tool_name,
                        "status": "failed",
                        "summary": err[:200],
                    },
                )
        if ran_ok:
            tr = invoke_registered_tool(pending.tool_name, pending.arguments, ctx)
            payload = tr.data if tr.status == "succeeded" else {"error": tr.error_message, "error_code": tr.error_code}
            session.draft_tool_results.append(
                {
                    "tool_call_id": pending.tool_call_id,
                    "name": pending.tool_name,
                    "content": tool_result_to_content(pending.tool_name, payload),
                }
            )
            append_audit(
                project_root,
                session_id=session.session_id,
                tool_name=pending.tool_name,
                status=tr.status,
                detail={"confirmed": True},
            )
            await emit(
                "tool_result",
                {
                    "tool_name": pending.tool_name,
                    "status": tr.status,
                    "summary": summarize_tool_result(pending.tool_name, payload),
                },
            )
            if ctx.session and pending.tool_name in (
                "agent.set_task_plan",
                "agent.update_task_step",
            ):
                await emit("task_update", {"steps": list(ctx.session.task_plan)})
        user_message = None

    if user_message is not None and user_message.strip():
        session.messages.append(ChatMessage(role="user", content=user_message.strip()))
        session.touch()
        await emit("thinking", {"message": _thinking_for_round(0)})

    if session.draft_assistant:
        stopped = await process_draft_loop()
        if stopped:
            return

    usage_acc: dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    text = ""
    repeat_count = 0
    last_tool_calls_sig = ""
    peak_context_est = 0
    loop_round = -1

    stable_txt = build_stable_system_prompt()
    public_ctx = {k: v for k, v in full_ctx.items() if not str(k).startswith("_")}
    # 首次构建（焦点切换后循环内会重建 tools_block_txt / dynamic_txt）
    _desc = tool_descriptions_for_prompt(tools_selected)
    tools_block_txt = build_tools_system_block(_desc)
    _need_rebuild_prompts = False

    while True:
        loop_round += 1
        if is_cancelled(session.session_id):
            clear_cancel(session.session_id)
            await emit("error", {"code": "cancelled", "message": "已按您的操作停止。"})
            await emit(
                "done",
                {"usage": usage_acc, "cancelled": True, "context_tokens_est": peak_context_est},
            )
            save_session(project_root, session)
            return

        await emit("thinking", {"message": _thinking_for_round(loop_round)})

        if _need_rebuild_prompts:
            _desc = tool_descriptions_for_prompt(tools_selected)
            tools_block_txt = build_tools_system_block(_desc)
            _need_rebuild_prompts = False

        system_content = cm.build_system_content(
            full_ctx,
            tools=tools_selected,
            skill_guidance=skill_guidance,
            current_focus=session.current_focus or None,
            plan_mode_active=session.plan_mode_active,
            execution_plan_path=session.execution_plan_path,
            skill_catalog=skill_catalog,
        )
        dynamic_txt = build_dynamic_system_prompt(
            project_ctx=public_ctx,
            skill_guidance=skill_guidance,
            current_focus=session.current_focus or None,
            plan_mode_active=session.plan_mode_active,
            execution_plan_path=session.execution_plan_path,
            skill_catalog=skill_catalog,
        )
        await emit(
            "context_metrics",
            {
                "stable_sha12": hash_text_sha12(stable_txt),
                "tools_block_sha12": hash_text_sha12(tools_block_txt),
                "dynamic_sha12": hash_text_sha12(dynamic_txt),
                "tool_schema_sha12": hash_tools_payload_sha12(tools_payload),
                "tool_count": len(tools_payload),
                "system_chars": len(system_content),
                "est_prompt_tokens": estimate_messages_tokens(
                    [{"role": "system", "content": system_content}]
                ),
            },
        )
        api_messages = cm.build_messages(
            system_content=system_content,
            session=session,
            user_message="",
        )
        if api_messages and api_messages[-1].get("role") == "user" and api_messages[-1].get("content") == "":
            api_messages.pop()

        peak_context_est = max(peak_context_est, estimate_messages_tokens(api_messages))

        try:
            full_content, streamed_tools, udelta, round_reasoning, finish_reason = await _llm_round_call(
                adapter,
                api_messages,
                tools_payload,
                temperature=0.3,
                emit=emit,
                max_tokens=max_tokens,
            )
        except Exception as e:
            await emit("error", {"code": "llm_error", "message": str(e)})
            save_session(project_root, session)
            await emit("done", {"usage": usage_acc, "context_tokens_est": peak_context_est})
            return
        for kk, vv in udelta.items():
            usage_acc[kk] = usage_acc.get(kk, 0) + vv

        if streamed_tools:
            sig = tool_calls_signature(streamed_tools)
            if sig == last_tool_calls_sig:
                repeat_count += 1
            else:
                repeat_count = 0
                last_tool_calls_sig = sig
            if repeat_count >= max_llm_rounds:
                msg = "检测到助手重复发起相同操作，已暂停本轮。"
                await emit("error", {"code": "repeat_loop", "message": msg})
                session.messages.append(
                    ChatMessage(
                        role="assistant",
                        content=msg,
                        reasoning_content=round_reasoning or "",
                    )
                )
                session.touch()
                text = msg
                break

            # Phase 1: check if switch_focus was called; rebuild tools if so
            focus_switched = False
            for tc in streamed_tools:
                fn = tc.get("function") or {}
                if fn.get("name") == "agent.switch_focus":
                    focus_switched = True
                # Phase 4: check for exit_plan_mode → emit plan_ready event
                if fn.get("name") == "agent.exit_plan_mode":
                    pass  # handled after tool execution via draft loop

            session.draft_assistant = {
                "content": full_content or None,
                "reasoning_content": round_reasoning or "",
                "tool_calls": streamed_tools,
            }
            session.draft_tool_results = []
            session.touch()
            stopped = await process_draft_loop()
            if stopped:
                return

            # Phase 1: if focus was switched during this round, rebuild tool set
            if focus_switched or session.current_focus:
                tools_selected, tools_payload = _rebuild_tools(
                    session, current_page, skill_id, cm.include_subtask_tool, project_root
                )
                _need_rebuild_prompts = True
                if focus_switched:
                    await emit("focus_changed", {"focus": session.current_focus})

            # Phase 4: if plan mode was just exited, emit plan_ready
            if session.current_plan_path and not session.plan_mode_active:
                plan_path = session.current_plan_path
                plan_content = ""
                try:
                    pp = (project_root / plan_path).resolve()
                    if pp.is_file():
                        plan_content = pp.read_text(encoding="utf-8")[:10000]
                except Exception:
                    pass
                steps = load_plan_steps_from_rel_path(project_root, plan_path)
                if steps:
                    set_plan(session, steps)
                    await emit("task_update", {"steps": list(session.task_plan)})
                plan_norm = normalize_rel_path(plan_path)
                await emit("plan_ready", {
                    "plan_file_path": plan_norm,
                    "content": plan_content,
                })
                session.pending_plan_path = plan_norm
                session.execution_plan_path = None
                session.current_plan_path = None

            continue

        if finish_reason == "length":
            session.messages.append(
                ChatMessage(
                    role="assistant",
                    content=full_content or "",
                    reasoning_content=round_reasoning or "",
                )
            )
            session.touch()
            text = (full_content or "").strip()
            break

        text = (full_content or "").strip()
        if text:
            session.messages.append(
                ChatMessage(
                    role="assistant",
                    content=text,
                    reasoning_content=round_reasoning or "",
                )
            )
            session.touch()
        break

    await emit("done", {"usage": usage_acc, "context_tokens_est": peak_context_est})
    save_session(project_root, session)

    if text:
        await emit_memory_after_assistant_turn(
            project_root,
            session,
            user_message=user_message,
            assistant_text=text,
            emit=emit,
            skip_memory_write=skip_memory_write,
        )


async def iter_agent_turn_sse(
    project_root: Path,
    session: SessionState,
    **kwargs: Any,
) -> AsyncIterator[str]:
    """Stream SSE as events are produced."""
    import json as _json

    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()

    async def emit(ev: str, data: dict[str, Any]) -> None:
        await queue.put((ev, data))

    emit_kw = kwargs.pop("emit", None)
    if emit_kw is not None:
        raise ValueError("emit is reserved")

    async def runner() -> None:
        try:
            await run_agent_turn(project_root, session, emit=emit, **kwargs)
        except Exception as e:
            await emit("error", {"code": "internal", "message": str(e)})
            await emit("done", {"usage": {}})
        finally:
            await queue.put(None)

    task = asyncio.create_task(runner())
    while True:
        item = await queue.get()
        if item is None:
            break
        ev, data = item
        yield f"event: {ev}\ndata: {_json.dumps(data, ensure_ascii=False)}\n\n"
    await task


