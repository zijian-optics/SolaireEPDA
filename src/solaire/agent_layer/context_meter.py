"""与编排层一致的上下文用量估算，供 HTTP 侧栏等在无 SSE 时刷新。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.agent_layer import skills as skills_mod
from solaire.agent_layer.context import ContextManager
from solaire.agent_layer.llm.deepseek_tokenizer import (
    context_limit_for_provider,
    estimate_context_prompt_tokens,
)
from solaire.agent_layer.llm.router import load_llm_settings
from solaire.agent_layer.models import SessionState
from solaire.agent_layer.registry import select_tools_for_turn


def context_meter_for_session(
    project_root: Path,
    session: SessionState,
    *,
    project_ctx: dict[str, Any],
) -> dict[str, int]:
    """基于当前会话落盘状态与项目上下文，估算下一轮请求前的上下文用量（与编排层同一套 build + 分词）。"""
    settings = load_llm_settings(project_root)
    cm = ContextManager(include_subtask_tool=True)
    full_ctx = {**project_ctx, "_project_root": project_root}

    skill_id: str | None = None
    if session.activated_skills:
        tail = str(session.activated_skills[-1]).strip()
        skill_id = tail or None

    sk = skills_mod.get_skill(skill_id, project_root) if skill_id else None
    skill_guidance = sk.prompt_fragment if sk else None
    skill_catalog = skills_mod.build_skill_catalog(project_root)

    tools_selected = select_tools_for_turn(
        skill_id=skill_id,
        include_subtask=cm.include_subtask_tool,
        current_focus=session.current_focus or None,
        project_root=project_root,
        plan_mode_active=session.plan_mode_active,
    )

    include_focus = len(session.messages) == 0

    sys_prefix, sys_suffix = cm.build_system_parts(
        full_ctx,
        session=session,
        tools=tools_selected,
        skill_guidance=skill_guidance,
        current_focus=session.current_focus or None,
        plan_mode_active=session.plan_mode_active,
        execution_plan_path=session.execution_plan_path,
        skill_catalog=skill_catalog,
        page_context_brief=None,
        include_focus_info=include_focus,
    )

    api_messages = cm.build_messages(
        system_prefix=sys_prefix,
        system_suffix=sys_suffix,
        session=session,
        user_message="",
    )
    if api_messages and api_messages[-1].get("role") == "user" and api_messages[-1].get("content") == "":
        api_messages.pop()

    est = int(estimate_context_prompt_tokens(settings.provider, settings.base_url, api_messages))
    out: dict[str, int] = {"context_tokens_est": est}
    lim = context_limit_for_provider(settings.provider, settings.base_url)
    if lim is not None:
        out["context_limit"] = int(lim)
    return out
