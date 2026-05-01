"""Post-turn memory / analysis history writes (extracted from orchestrator)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from solaire.agent_layer.audit import append_audit
from solaire.agent_layer.memory import append_session_digest_line, merge_index_bullet, read_topic, write_topic
from solaire.agent_layer.models import SessionState

EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]

_MAX_TOPIC_LINES = 240
_TRIM_KEEP_TAIL = 130


def _cap_lines(text: str) -> str:
    lines = text.strip().splitlines()
    if len(lines) <= _MAX_TOPIC_LINES:
        t = text.strip()
        return t + ("\n" if t and not t.endswith("\n") else "")
    tail = lines[-_TRIM_KEEP_TAIL:]
    head_notice = "## （较早记录已省略，仅保留最近条目）\n\n"
    return head_notice + "\n".join(tail) + "\n"


def _should_auto_remember(last_user: str, assistant_text: str) -> bool:
    """闲聊与过短回复不写盘，减少记忆污染。"""
    u = last_user.strip()
    a = assistant_text.strip()
    if len(a) < 36:
        return False
    trivial_u = {x.lower() for x in ("好的", "好", "谢谢", "感谢", "嗯", "ok", "okay", "yes", "y")}
    if len(u) <= 12 and u.lower() in trivial_u:
        return False
    if len(u) >= 10:
        return True
    keywords = (
        "分析",
        "导出",
        "试卷",
        "题目",
        "图谱",
        "成绩",
        "考试",
        "模板",
        "校验",
        "组卷",
        "学生",
        "班级",
        "作业",
        "知识点",
    )
    blob = u + a
    if any(k in blob for k in keywords):
        return True
    return len(a) >= 100


def append_analysis_history_line(project_root: Path, line: str) -> None:
    from datetime import datetime, timezone

    from solaire.agent_layer import memory as mem_mod

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    prev = read_topic(project_root, "analysis_history.md")
    block = (prev.strip() + "\n\n" if prev.strip() else "") + f"- {ts} UTC — {line}\n"
    write_topic(project_root, "analysis_history.md", _cap_lines(block))
    idx = mem_mod.read_index(project_root)
    if "暂无条目" in idx or len(idx) < 40:
        mem_mod.write_index(
            project_root,
            "## 记忆索引\n"
            "- [分析记录](analysis_history.md): 助手自动追加的对话摘要条目\n",
        )


async def emit_memory_after_assistant_turn(
    project_root: Path,
    session: SessionState,
    *,
    user_message: str | None,
    assistant_text: str,
    emit: EmitFn,
) -> None:
    """Append analysis history / digest when there is both a user line and assistant reply."""
    last_user_text = user_message
    if not (last_user_text and last_user_text.strip()):
        for m in reversed(session.messages):
            if m.role == "user" and (m.content or "").strip():
                last_user_text = m.content.strip()
                break
    if not (last_user_text and assistant_text.strip()):
        return
    if not _should_auto_remember(last_user_text, assistant_text):
        return
    try:
        snippet = f"用户：{last_user_text[:120]}… / 助手摘要：{assistant_text[:160]}…"
        append_analysis_history_line(project_root, snippet)
        changed = ["analysis_history.md"]
        append_session_digest_line(
            project_root,
            f"{last_user_text[:80]}… → {assistant_text[:120]}…",
        )
        changed.append("session_digest.md")
        bullet = f"[分析记录](analysis_history.md) {assistant_text[:200]}".strip()
        if len(bullet) > 240:
            bullet = bullet[:237] + "…"
        if merge_index_bullet(project_root, bullet):
            changed.append("INDEX.md")
        await emit("memory_updated", {"topics_changed": changed})
    except Exception as e:
        await emit("memory_update_failed", {"message": str(e)})
        append_audit(
            project_root,
            session_id=session.session_id,
            tool_name=None,
            status="memory_update_failed",
            detail={"error": str(e)},
        )
