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


def _names_starting(prefix: str) -> tuple[str, ...]:
    return tuple(sorted(t.name for t in TOOLS if t.name.startswith(prefix)))


def _merge_unique(*groups: tuple[str, ...]) -> tuple[str, ...]:
    seen: set[str] = set()
    out: list[str] = []
    for g in groups:
        for n in g:
            if n not in seen:
                seen.add(n)
                out.append(n)
    return tuple(out)


_ALL_ANALYSIS = _names_starting("analysis.")
_ALL_BANK = _names_starting("bank.")
_ALL_GRAPH = _names_starting("graph.")
_ALL_EXAM = _names_starting("exam.")
_ALL_FILE = _names_starting("file.")
_ALL_DOC = _names_starting("doc.")
_ALL_MEMORY = _names_starting("memory.")
_ALL_WEB = _names_starting("web.")

_AGENT_CORE: tuple[str, ...] = (
    "agent.switch_focus",
    "agent.activate_skill",
    "agent.read_skill_reference",
    "agent.enter_plan_mode",
    "agent.exit_plan_mode",
    "agent.set_task_plan",
    "agent.update_task_step",
)
_SUBTASK_PIPELINE: tuple[str, ...] = ("agent.run_subtask", "agent.run_tool_pipeline")
_FILE_RO: tuple[str, ...] = ("file.read", "file.list", "file.search")

_GENERAL_DOMAIN: tuple[str, ...] = (
    "analysis.list_datasets",
    "analysis.list_builtins",
    "analysis.run_builtin",
    "analysis.get_job",
    "exam.list_templates",
    "graph.list_nodes",
    "graph.search_nodes",
    "bank.search_items",
    "bank.get_item",
)

_COMPOSE_GRAPH: tuple[str, ...] = ("graph.list_nodes", "graph.list_relations", "graph.search_nodes")

_BANK_GRAPH: tuple[str, ...] = (
    "graph.bind_question",
    "graph.batch_bind_questions",
    "graph.list_nodes",
    "graph.search_nodes",
)

_ANALYSIS_FOCUS = _merge_unique(_AGENT_CORE, _FILE_RO, _SUBTASK_PIPELINE, _ALL_MEMORY, _ALL_WEB, _ALL_ANALYSIS)
_BANK_FOCUS = _merge_unique(_AGENT_CORE, _FILE_RO, _SUBTASK_PIPELINE, _ALL_BANK, _BANK_GRAPH)
_GRAPH_FOCUS = _merge_unique(_AGENT_CORE, _FILE_RO, _SUBTASK_PIPELINE, _ALL_GRAPH, _ALL_BANK)
_COMPOSE_FOCUS = _merge_unique(
    _AGENT_CORE,
    _FILE_RO,
    _SUBTASK_PIPELINE,
    _ALL_MEMORY,
    _ALL_EXAM,
    _ALL_BANK,
    _COMPOSE_GRAPH,
    ("file.write", "file.edit"),
)
_DOC_FOCUS = _merge_unique(_AGENT_CORE, _FILE_RO, _SUBTASK_PIPELINE, _ALL_FILE, _ALL_DOC)
_GENERAL_FOCUS = _merge_unique(_AGENT_CORE, _FILE_RO, _GENERAL_DOMAIN)


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


def resolve_effective_tool_scope(
    *,
    skill_id: str | None,
    session_focus: str | None,
) -> str:
    """用于选择工具集的聚焦域；不得从 App 当前界面推导。"""
    if skill_id and skill_id.strip():
        return (session_focus or "").strip() or "general"
    return (session_focus or "").strip() or "general"


# 聚焦态工具预设（显式工具名，避免通配导致 schema 抖动）
FOCUS_PRESETS: dict[str, tuple[str, ...]] = {
    "general": _GENERAL_FOCUS,
    "analysis": _ANALYSIS_FOCUS,
    "bank": _BANK_FOCUS,
    "graph": _GRAPH_FOCUS,
    "compose": _COMPOSE_FOCUS,
    "doc_process": _DOC_FOCUS,
}


def select_tools_for_turn(
    *,
    skill_id: str | None,
    include_subtask: bool,
    current_focus: str | None = None,
    project_root: Any = None,
    plan_mode_active: bool = False,
) -> list[RegisteredTool]:
    """选择本轮可用工具。**不得**传入或依据 App 当前页面。"""
    from solaire.agent_layer import skills as skills_mod

    focus_key = resolve_effective_tool_scope(skill_id=skill_id, session_focus=current_focus)
    patterns: tuple[str, ...] | None = None
    if skill_id:
        sk = skills_mod.get_skill(skill_id.strip(), project_root)
        if sk:
            patterns = sk.tool_patterns
    if patterns is None:
        patterns = FOCUS_PRESETS.get(focus_key) or FOCUS_PRESETS["general"]

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
        if st.name not in seen:
            picked.append(st)
            seen.add(st.name)
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
