"""Parse SolEdu agent plan files (.md): YAML --- frontmatter + todos → task_plan steps."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from solaire.common.security import assert_within_project

# 与 file_tools 校验共用同一围栏模式（单源）
PLAN_MD_FRONTMATTER = re.compile(r"^---\r?\n(?P<fm>.*?)\r?\n---\r?\n", re.DOTALL)

_AGENT_PLANS_SEGMENTS = (".solaire", "agent", "plans")


def normalize_rel_path(rel: str) -> str:
    """项目内相对路径规范化（ POSIX、去首尾空白，非法含 .. 时返回空）。"""
    s = str(rel).replace("\\", "/").strip().strip("/")
    if not s or ".." in s.split("/"):
        return ""
    return s


def _is_under_agent_plans(project_root: Path, rel: str) -> bool:
    raw = normalize_rel_path(rel)
    if not raw:
        return False
    try:
        p = (project_root / raw).resolve()
        assert_within_project(project_root, p)
        plans_root = (project_root.joinpath(*_AGENT_PLANS_SEGMENTS)).resolve()
        if p == plans_root:
            return False
        return plans_root in p.parents or p.parent == plans_root
    except Exception:
        return False


def validate_plan_markdown_body(content: str) -> tuple[bool, str]:
    """计划 *.md：YAML --- 围栏 + name/overview/todos。"""
    text = content.lstrip("\ufeff")
    m = PLAN_MD_FRONTMATTER.match(text)
    if not m:
        return False, "须以 YAML 围栏开头：首行 ---，中间为 YAML，再以独占一行的 --- 结束，随后为正文"
    fm = m.group("fm")
    if "name:" not in fm:
        return False, "YAML 围栏内须包含 name 字段"
    if "overview:" not in fm:
        return False, "YAML 围栏内须包含 overview 字段"
    if "todos" not in fm:
        return False, "YAML 围栏内须包含 todos 字段（任务列表，含 id/content/status 等）"
    return True, ""


def validate_agent_plan_rel_path(project_root: Path, rel: str) -> tuple[bool, str]:
    """校验项目内计划文件路径：位于 .solaire/agent/plans/ 且正文符合 harness。"""
    raw = normalize_rel_path(rel)
    if not raw:
        return False, "无效的计划文件路径"
    if not _is_under_agent_plans(project_root, raw):
        return False, "计划文件须位于 .solaire/agent/plans/ 目录下"
    try:
        p = (project_root / raw).resolve()
        assert_within_project(project_root, p)
    except Exception:
        return False, "无法解析计划文件路径"
    if not p.is_file():
        return False, "计划文件不存在，请先落盘计划再退出计划模式"
    try:
        body = p.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return False, f"读取计划文件失败：{e}"
    return validate_plan_markdown_body(body)


def split_frontmatter(text: str) -> tuple[str | None, str]:
    """返回 (围栏内 YAML 原文, 全文去掉 BOM)。解析失败时 fm 为 None。"""
    raw = text.lstrip("\ufeff")
    m = PLAN_MD_FRONTMATTER.match(raw)
    if not m:
        return None, raw
    return m.group("fm"), raw


def _yaml_load(fm_text: str) -> dict[str, Any] | None:
    try:
        import yaml

        data = yaml.safe_load(fm_text)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def todos_to_set_plan_steps(todos: Any) -> list[dict[str, Any]]:
    """将 YAML todos 转为 task_tracker.set_plan 所需 steps：{title, status}。"""
    if not isinstance(todos, list):
        return []
    out: list[dict[str, Any]] = []
    for t in todos:
        if isinstance(t, dict):
            tid = str(t.get("id", "")).strip()
            content = str(t.get("content", "")).strip()
            status = str(t.get("status", "pending")).strip() or "pending"
            if tid and content:
                title = f"{tid}: {content}"
            elif content:
                title = content
            elif tid:
                title = tid
            else:
                continue
            out.append({"title": title, "status": status})
        elif isinstance(t, str) and t.strip():
            out.append({"title": t.strip(), "status": "pending"})
    return out


def steps_from_plan_body(text: str) -> list[dict[str, Any]]:
    """从计划文件全文解析 todos → steps；失败返回 []。"""
    fm_text, _ = split_frontmatter(text)
    if not fm_text:
        return []
    data = _yaml_load(fm_text)
    if not data:
        return []
    return todos_to_set_plan_steps(data.get("todos"))


def load_plan_steps_from_rel_path(project_root: Path, rel_path: str) -> list[dict[str, Any]]:
    """读项目内计划文件并返回 set_plan 用 steps。"""
    rel = normalize_rel_path(rel_path)
    if not rel or ".." in rel.split("/"):
        return []
    try:
        p = (project_root / rel).resolve()
        assert_within_project(project_root, p)
    except Exception:
        return []
    if not p.is_file():
        return []
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []
    return steps_from_plan_body(text)
