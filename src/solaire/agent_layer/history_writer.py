"""Post-turn analysis history writes (extracted from orchestrator)."""

from __future__ import annotations

from pathlib import Path

from solaire.agent_layer.memory import _cap_memory_file_lines as _cap_lines, read_topic, write_topic


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
