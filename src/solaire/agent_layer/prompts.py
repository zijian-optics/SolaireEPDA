"""Prompt as Protocol: layered system prompt assembly (M3 Harness)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# 进入提示词的项目级字段白名单（减小动态层抖动；其它键仅用于 HTTP/观测不下发 LLM）
PROJECT_CTX_WHITELIST: frozenset[str] = frozenset(
    {"project_label", "exam_summary", "template_count", "graph_node_count"}
)


def whitelist_project_ctx_for_prompt(project_ctx: dict[str, Any]) -> dict[str, Any]:
    """只保留白名单字段，键名排序后参与拼装，利于稳定序列化。"""
    keys = sorted(k for k in project_ctx if k in PROJECT_CTX_WHITELIST and k in project_ctx)
    return {k: project_ctx[k] for k in keys}


def format_page_context_brief(page_context: dict[str, Any] | None) -> str:
    """短动态块：教师当前界面摘要（不得参与工具集选择）。"""
    if not page_context:
        return ""
    cur = page_context.get("current_page")
    sel_t = page_context.get("selected_resource_type")
    sel_id = page_context.get("selected_resource_id")
    summ = page_context.get("summary")
    lines: list[str] = ["## 界面速览"]
    if cur:
        lines.append(f"- 当前：**{cur}**")
    else:
        lines.append("- 当前：未指定")
    if sel_id or sel_t:
        st = sel_t or ""
        lines.append(f"- 选中资源：**{st}** `{sel_id or ''}`".strip())
    if summ and str(summ).strip():
        lines.append(f"- 教师备注：**{str(summ).strip()[:500]}**")
    return "\n".join(lines)


def _layer_role() -> str:
    return (
        "## 角色\n"
        "你是 SolEdu 智能教学助手，协助教师完成题库维护、知识图谱、组卷与导出、"
        "考试结果分析与脚本诊断等全流程工作。"
        "回答使用简体中文，面向教师业务场景，避免暴露底层实现细节。"
    )


def _layer_goal() -> str:
    return (
        "## 任务范围\n"
        "在授权范围内：列举考试数据、运行内置分析、保存与运行分析脚本、查询作业结果、"
        "检索与维护题库中的独立题目、读取与维护知识图谱、将题目挂接到知识点、"
        "批量维护要点与挂接、读取项目内文件（写入能力视当前聚焦域而定）、文档格式转换（Word/PDF/OCR）、"
        "联网检索公开资料（可选配置）、"
        "以及组卷相关能力（校验与导出需确认）。"
        "超出工具能力时请明确说明，并建议教师手动操作路径。"
    )


_FOCUS_LABEL: dict[str, str] = {
    "general": "通用",
    "bank": "题库管理",
    "graph": "知识图谱",
    "analysis": "成绩分析",
    "compose": "组卷与导出",
    "doc_process": "文档处理",
}


def _layer_context(project_ctx: dict[str, Any]) -> str:
    # 仅输出白名单内的项目级统计；界面信息放在 format_page_context_brief
    ctx = whitelist_project_ctx_for_prompt(project_ctx)
    lines = ["## 项目状态"]
    lines.append(f"- 项目路径：{ctx.get('project_label', '当前项目')}")
    if exams := ctx.get("exam_summary"):
        lines.append(f"- 考试数据概览：{exams}")
    if "template_count" in ctx:
        lines.append(f"- 可用试卷模板数量：{ctx.get('template_count')}")
    if "graph_node_count" in ctx:
        lines.append(f"- 知识图谱节点数量：{ctx.get('graph_node_count')}")
    return "\n".join(lines)


def _layer_focus(current_focus: str | None) -> str:
    focus = current_focus or "general"
    label = _FOCUS_LABEL.get(focus, focus)
    lines = [
        "## 聚焦态",
        f"- 当前聚焦域：**{label}**（`{focus}`）",
        "- 可用工具集已根据聚焦域自动筛选。",
        "- 若需的能力不在当前工具集中，请用 `agent.switch_focus` 切换域，或用 `agent.activate_skill` 激活技能——"
        "**勿将「工具未列出」描述为「平台无此能力」或「无权限」。**",
        f"  可选域：{', '.join(_FOCUS_LABEL.keys())}",
    ]
    return "\n".join(lines)


def _layer_tools(tool_descriptions: str) -> str:
    return (
        f"## 可用能力（通过工具调用）\n{tool_descriptions.strip()}\n"
        "- 仅能调用上表所列能力。若需的能力不在当前工具集中，请先用 `agent.switch_focus` 切换到合适的聚焦域。"
    )


def _layer_constraints() -> str:
    return (
        "## 行为约束（必须遵守）\n"
        "- 严禁编造不存在的考试数据或分析结果。\n"
        "- 严禁在未获教师确认的情况下执行删除、覆盖或导出试卷等高风险操作。\n"
        "- 严禁猜测资源标识；应先通过列举类工具确认。\n"
        "- 引用记忆中的历史结论前，须先使用记忆读取工具核对原文。\n"
        "- 工具失败须如实说明原因与建议下一步。\n"
    )


def _layer_risk_policy() -> str:
    return (
        "## 风险与确认\n"
        "- 只读类操作可直接执行。\n"
        "- 写入类操作可能需要教师确认；同一会话内教师已批准的同类操作可自动放行。\n"
        "- 破坏性操作一律需要教师确认。\n"
        "- 勿将「需确认」描述为「无权限」或「禁止操作」。\n"
    )


def _layer_output_format() -> str:
    return (
        "## 输出规范\n"
        "- 分析结论须注明数据来源（考试标识、批次、样本量等）。\n"
        "- 建议分为「可立即执行」与「需进一步确认」两类。\n"
        "- 生成的分析脚本须符合平台沙箱限制（允许的模块列表见工具说明）。\n"
    )


def _layer_decision_rules() -> str:
    return (
        "## 决策规则\n"
        "- 复杂、多轮试错或大体量数据综合任务，优先使用子任务深度分析工具，避免主对话上下文膨胀。\n"
        "- 若单次工具输出过长，应依赖系统已做的摘要；需要明细时再调用相应只读工具。\n"
        "- 对于复杂的多步任务，可调用 `agent.enter_plan_mode` 先制定计划再执行。\n"
    )


def _layer_compose_hints() -> str:
    return (
        "## 组卷与导出\n"
        "- 若版式编译未通过或导出失败，请根据工具返回的报错与题干内容调整题目或模板，"
        "避免在相同条件下反复调用校验而不改内容。\n"
        "- 需要确认版式能否生成时，在校验工具中开启版式编译试跑；结构通过仅代表选题与模板匹配，"
        "不等于版式已试跑通过。\n"
    )


def _layer_plan_mode() -> str:
    return (
        "## 计划模式（当前激活）\n"
        "流程：先只读探索 → 将计划写入 `.solaire/agent/plans/{name}.md` → 调用 `agent.exit_plan_mode`。\n"
        "- 计划文件须以 YAML 围栏开头（`---`），含 `name`、`overview`、`todos` 字段，再以 `---` 结束。\n"
        "- todos 为列表，每项含 `id`、`content`、`status`（如 pending）。\n"
        "- 仅允许只读工具与 `.solaire/agent/plans/` 下的 file.write / file.edit。\n"
        "- 落盘后调用 `agent.exit_plan_mode`，参数 `plan_file_path` 为写入的项目内相对路径。\n"
    )


def _layer_plan_execution(execution_plan_path: str) -> str:
    path = execution_plan_path.strip()
    return (
        "## 计划执行（当前生效）\n"
        f"- 已批准按计划文件执行：项目内路径 `{path}`。\n"
        "- 请严格按下方「当前任务步骤」逐项推进；每完成一步请调用 `agent.update_task_step` 更新序号与状态。\n"
        "- 全部步骤完成后再作总结答复。\n"
    )


def _layer_skill_catalog(skill_catalog: str | None) -> str:
    if not skill_catalog or not skill_catalog.strip():
        return ""
    return (
        "## 可用技能目录\n"
        "以下技能提供特定任务的专业指引。当任务匹配某个技能的描述时，"
        "调用 `agent.activate_skill` 加载完整指令。\n\n"
        + skill_catalog.strip()
    )


def _load_prompt_overrides(project_root: Path | None) -> str:
    """Phase 5: Load project-level prompt overrides from .solaire/agent/system_prompt_overrides.md"""
    if project_root is None:
        return ""
    p = project_root / ".solaire" / "agent" / "system_prompt_overrides.md"
    if not p.is_file():
        return ""
    try:
        return p.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def _apply_overrides(base_prompt: str, overrides: str) -> str:
    """Replace or append sections based on ## headings in the override file."""
    if not overrides:
        return base_prompt
    import re

    override_sections: dict[str, str] = {}
    current_heading = None
    current_lines: list[str] = []

    for line in overrides.split("\n"):
        m = re.match(r"^##\s+(.+)$", line)
        if m:
            if current_heading:
                override_sections[current_heading] = "\n".join(current_lines).strip()
            current_heading = m.group(1).strip()
            current_lines = [line]
        else:
            current_lines.append(line)
    if current_heading:
        override_sections[current_heading] = "\n".join(current_lines).strip()

    result = base_prompt
    for heading, content in override_sections.items():
        pattern = re.compile(
            rf"(## {re.escape(heading)}\n).*?(?=\n## |\Z)",
            re.DOTALL,
        )
        if pattern.search(result):
            result = pattern.sub(content, result, count=1)
        else:
            result = result.rstrip() + "\n\n" + content

    return result


def build_stable_system_prompt() -> str:
    """不随焦点/页面/计划状态变化的系统提示核心（利于稳定前缀与缓存）。"""
    parts = [
        _layer_role(),
        _layer_goal(),
        _layer_constraints(),
        _layer_risk_policy(),
        _layer_output_format(),
        _layer_decision_rules(),
    ]
    return "\n\n".join(parts)


def build_tools_system_block(tool_descriptions: str) -> str:
    """工具描述块：随焦点域变化但同一焦点内稳定。"""
    return _layer_tools(tool_descriptions)


def build_dynamic_system_prompt(
    *,
    project_ctx: dict[str, Any],
    skill_guidance: str | None = None,
    current_focus: str | None = None,
    plan_mode_active: bool = False,
    execution_plan_path: str | None = None,
    skill_catalog: str | None = None,
    task_plan_block: str | None = None,
    page_context_brief: str | None = None,
    include_focus_info: bool = True,
) -> str:
    """随项目摘要、计划状态变化的提示层（任务步骤与界面速览为短动态）。"""
    chunks: list[str] = []
    if skill_guidance and skill_guidance.strip():
        chunks.append("## 当前协助重点\n" + skill_guidance.strip())
    if (current_focus or "").strip() == "compose":
        chunks.append(_layer_compose_hints())
    if plan_mode_active:
        chunks.append(_layer_plan_mode())
    if execution_plan_path and execution_plan_path.strip():
        chunks.append(_layer_plan_execution(execution_plan_path))
    if task_plan_block and task_plan_block.strip():
        chunks.append(task_plan_block.strip())
    chunks.append(_layer_context(project_ctx))
    # 聚焦态仅在首轮告知；此后模型从对话历史与工具集即可知悉
    if include_focus_info:
        chunks.append(_layer_focus(current_focus))
    catalog_section = _layer_skill_catalog(skill_catalog)
    if catalog_section:
        chunks.append(catalog_section)
    if page_context_brief and page_context_brief.strip():
        chunks.append(page_context_brief.strip())
    return "\n\n".join(chunks)


def dynamic_source_hashes(
    *,
    project_ctx: dict[str, Any],
    skill_catalog: str | None,
    task_plan_block: str | None,
    page_context_brief: str | None,
    plan_mode_active: bool,
    execution_plan_path: str | None,
) -> dict[str, str]:
    """分项 sha12，便于观测是哪块导致动态层变化。"""
    from solaire.agent_layer.llm.prompt_cache import hash_text_sha12

    w = whitelist_project_ctx_for_prompt(project_ctx)
    proj_h = hash_text_sha12(json.dumps(w, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str))
    cat_h = hash_text_sha12(skill_catalog or "")
    plan_blk_h = hash_text_sha12(task_plan_block or "")
    page_h = hash_text_sha12(page_context_brief or "")
    state = {
        "plan_mode_active": plan_mode_active,
        "execution_plan_path": (execution_plan_path or "").strip(),
    }
    plan_st_h = hash_text_sha12(json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return {
        "project_ctx_sha12": proj_h,
        "skill_catalog_sha12": cat_h,
        "task_plan_sha12": plan_blk_h,
        "page_context_sha12": page_h,
        "plan_state_sha12": plan_st_h,
        "dynamic_sources_sha12": hash_text_sha12(proj_h + "|" + cat_h + "|" + plan_blk_h + "|" + page_h + "|" + plan_st_h),
    }


def build_system_prompt(
    *,
    tool_descriptions: str,
    project_ctx: dict[str, Any],
    skill_guidance: str | None = None,
    current_focus: str | None = None,
    plan_mode_active: bool = False,
    execution_plan_path: str | None = None,
    skill_catalog: str | None = None,
    project_root: Path | None = None,
) -> str:
    """Assemble full system prompt (protocol stack): stable + tools_block + dynamic."""
    stable = build_stable_system_prompt()
    tools_block = build_tools_system_block(tool_descriptions)
    dynamic = build_dynamic_system_prompt(
        project_ctx=project_ctx,
        skill_guidance=skill_guidance,
        current_focus=current_focus,
        plan_mode_active=plan_mode_active,
        execution_plan_path=execution_plan_path,
        skill_catalog=skill_catalog,
        task_plan_block=None,
        page_context_brief=None,
    )
    base = stable + "\n\n" + tools_block + "\n\n" + dynamic

    overrides = _load_prompt_overrides(project_root)
    if overrides:
        base = _apply_overrides(base, overrides)

    return base


def build_system_prompt_cached(
    *,
    tool_descriptions: str,
    project_ctx: dict[str, Any],
    skill_guidance: str | None = None,
    current_focus: str | None = None,
    plan_mode_active: bool = False,
    execution_plan_path: str | None = None,
    skill_catalog: str | None = None,
    task_plan_block: str | None = None,
    page_context_brief: str | None = None,
    project_root: Path | None = None,
    include_focus_info: bool = True,
) -> tuple[str, str]:
    """返回 (cacheable_prefix, dynamic_suffix)。

    DeepSeek KV Cache 按字节前缀匹配消息数组。将稳定部分（角色+约束+工具）
    与动态部分（项目摘要/界面/计划状态）拆成两条 system 消息后，前缀在多次
    请求间保持一致，从而命中缓存。
    """
    stable = build_stable_system_prompt()
    tools_block = build_tools_system_block(tool_descriptions)
    dynamic = build_dynamic_system_prompt(
        project_ctx=project_ctx,
        skill_guidance=skill_guidance,
        current_focus=current_focus,
        plan_mode_active=plan_mode_active,
        execution_plan_path=execution_plan_path,
        skill_catalog=skill_catalog,
        task_plan_block=task_plan_block,
        page_context_brief=page_context_brief,
        include_focus_info=include_focus_info,
    )
    prefix = stable + "\n\n" + tools_block
    overwrites = _load_prompt_overrides(project_root)
    if overwrites:
        prefix = _apply_overrides(prefix, overwrites)
    return prefix, dynamic


# Prompt layer versions for observability (incremented on semantic change)
PROMPT_LAYER_VERSIONS: dict[str, int] = {
    "role": 1,
    "goal": 1,
    "context": 1,
    "focus": 1,
    "tools": 1,
    "constraints": 1,
    "risk_policy": 1,
    "output_format": 1,
    "decision_rules": 1,
    "compose_hints": 1,
    "plan_mode": 2,
    "plan_execution": 1,
    "skill_catalog": 1,
    "overrides": 1,
}
