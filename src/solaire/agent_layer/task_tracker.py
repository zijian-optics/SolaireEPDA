"""Task plan tracking for multi-step agent work."""

from __future__ import annotations

from typing import Any

from solaire.agent_layer.models import SessionState


def set_plan(session: SessionState, steps: list[dict[str, Any]]) -> None:
    session.task_plan = [{"title": s.get("title", ""), "status": s.get("status", "pending")} for s in steps]
    session.touch()


def update_step(session: SessionState, index: int, status: str) -> None:
    if 0 <= index < len(session.task_plan):
        session.task_plan[index]["status"] = status
        session.touch()


def plan_to_prompt_block(session: SessionState) -> str:
    if not session.task_plan:
        return ""
    lines = ["当前任务步骤："]
    for i, s in enumerate(session.task_plan, start=1):
        lines.append(f"{i}. [{s.get('status', '?')}] {s.get('title', '')}")
    return "\n".join(lines)


def build_task_plan_dynamic_block(session: SessionState) -> str:
    """并入动态系统提示的任务步骤摘要（不写第三条 system）。"""
    if not session.task_plan:
        return ""
    lines = [
        f"{i}. [{s.get('status', '?')}] {s.get('title', '')}" for i, s in enumerate(session.task_plan, start=1)
    ]
    return "## 当前任务进度\n" + "\n".join(lines)
