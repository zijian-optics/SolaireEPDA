"""Unified tool registry: lookup, selection, and OpenAI function schemas."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from solaire.agent_layer.models import InvocationContext, ToolResult
from solaire.agent_layer.tools.tool_definitions import (
    SUBTASK_TOOL_NAME,
    TOOLS,
    RegisteredTool,
    subtask_tool_schema,
)

_TOOL_BY_NAME: dict[str, RegisteredTool] = {t.name: t for t in TOOLS}


def get_registered_tool(tool_name: str) -> RegisteredTool | None:
    if tool_name == SUBTASK_TOOL_NAME:
        return subtask_tool_schema()
    return _TOOL_BY_NAME.get(tool_name)


def tool_name_matches_patterns(name: str, patterns: Iterable[str]) -> bool:
    for pat in patterns:
        if pat.endswith("*"):
            base = pat[:-1]
            if base and name.startswith(base):
                return True
        elif name == pat:
            return True
    return False


# 通用工具：所有聚焦态下始终可见
_ALWAYS_VISIBLE: tuple[str, ...] = (
    "memory.*",
    "agent.*",
    "web.*",
    "file.read",
    "file.list",
    "file.search",
)

# 聚焦态工具预设
FOCUS_PRESETS: dict[str, tuple[str, ...]] = {
    "general": (
        *_ALWAYS_VISIBLE,
        "analysis.list_datasets",
        "analysis.list_builtins",
        "analysis.run_builtin",
        "analysis.get_job",
        "exam.list_templates",
        "graph.list_nodes",
        "graph.search_nodes",
        "bank.search_items",
        "bank.get_item",
    ),
    "analysis": (*_ALWAYS_VISIBLE, "analysis.*"),
    "bank": (
        *_ALWAYS_VISIBLE,
        "bank.*",
        "graph.bind_question",
        "graph.batch_bind_questions",
        "graph.list_nodes",
        "graph.search_nodes",
    ),
    "graph": (*_ALWAYS_VISIBLE, "graph.*", "bank.*"),
    "compose": (
        *_ALWAYS_VISIBLE,
        "exam.*",
        "bank.*",
        "graph.list_nodes",
        "graph.list_relations",
        "graph.search_nodes",
        "file.write",
        "file.edit",
    ),
    "doc_process": (
        *_ALWAYS_VISIBLE,
        "file.*",
        "doc.*",
    ),
}

# 旧页面名到聚焦态的映射（向后兼容前端 page_context）
_PAGE_TO_FOCUS: dict[str, str] = {
    "analysis": "analysis",
    "bank": "bank",
    "graph": "graph",
    "compose": "compose",
    "template": "compose",
    "help": "general",
    "log": "general",
    "settings": "general",
}


def select_tools_for_turn(
    *,
    current_page: str | None,
    skill_id: str | None,
    include_subtask: bool,
    current_focus: str | None = None,
    project_root: Any = None,
    plan_mode_active: bool = False,
) -> list[RegisteredTool]:
    from solaire.agent_layer import skills as skills_mod

    patterns: tuple[str, ...] | None = None
    if skill_id:
        sk = skills_mod.get_skill(skill_id.strip(), project_root)
        if sk:
            patterns = sk.tool_patterns
    if patterns is None:
        focus = (current_focus or "").strip()
        if not focus:
            page_key = (current_page or "").strip()
            focus = _PAGE_TO_FOCUS.get(page_key, "general")
        patterns = FOCUS_PRESETS.get(focus) or FOCUS_PRESETS["general"]

    picked: list[RegisteredTool] = []
    seen: set[str] = set()
    for t in TOOLS:
        if not tool_name_matches_patterns(t.name, patterns):
            continue
        if t.name in seen:
            continue
        seen.add(t.name)
        picked.append(t)
    if include_subtask:
        st = subtask_tool_schema()
        if tool_name_matches_patterns(st.name, patterns) and st.name not in seen:
            picked.append(st)
    # 计划模式：暴露写入/编辑工具以落盘计划文件
    if plan_mode_active:
        for _plan_tool in ("file.write", "file.edit"):
            if _plan_tool not in seen:
                pt = _TOOL_BY_NAME.get(_plan_tool)
                if pt:
                    picked.append(pt)
                    seen.add(_plan_tool)
    return picked


SUBAGENT_EXCLUDED_NAMES: frozenset[str] = frozenset(
    {
        "agent.enter_plan_mode",
        "agent.exit_plan_mode",
        "agent.switch_focus",
        "agent.set_task_plan",
        "agent.update_task_step",
        "agent.run_subtask",
        "agent.run_tool_pipeline",
        "agent.activate_skill",
        "file.write",
        "file.edit",
    }
)


def tools_for_subagent(*, allowed_prefixes: list[str] | None) -> list[RegisteredTool]:
    tools = [t for t in all_registered_tools(include_subtask=False) if t.name not in SUBAGENT_EXCLUDED_NAMES]
    if allowed_prefixes:
        pfx = tuple(allowed_prefixes)

        def _ok(name: str) -> bool:
            return any(name.startswith(x.rstrip("*")) or name.startswith(x) for x in pfx)

        tools = [t for t in tools if _ok(t.name)]
    return tools


def all_registered_tools(include_subtask: bool = True) -> list[RegisteredTool]:
    if include_subtask:
        return [*TOOLS, subtask_tool_schema()]
    return list(TOOLS)


def openai_tools_payload(tools: list[RegisteredTool] | None = None) -> list[dict[str, Any]]:
    tlist = tools or all_registered_tools()
    out: list[dict[str, Any]] = []
    for t in tlist:
        out.append(
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters_schema,
                },
            }
        )
    return out


def tool_descriptions_for_prompt(tools: list[RegisteredTool] | None = None) -> str:
    tlist = tools or all_registered_tools()
    lines = []
    for t in tlist:
        lines.append(f"- `{t.name}`: {t.description}")
    return "\n".join(lines)


def invoke_registered_tool(name: str, args: dict[str, Any], ctx: InvocationContext) -> ToolResult:
    if name == SUBTASK_TOOL_NAME:
        return ToolResult(status="failed", error_code="internal", error_message="subtask not invokable here")
    rt = _TOOL_BY_NAME.get(name)
    if rt is None:
        return ToolResult(status="failed", error_code="unknown_tool", error_message=f"未知工具: {name}")
    return rt.handler(ctx, args)
