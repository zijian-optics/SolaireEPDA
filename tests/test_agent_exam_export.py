"""exam.export_paper parity with web export (mark_exported, backup hooks)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from solaire.agent_layer.models import InvocationContext, SessionState
from solaire.agent_layer.tools import exam_tools


def test_tool_export_paper_calls_mark_exported(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    (tmp_path / ".solaire").mkdir(parents=True, exist_ok=True)
    tpl = tmp_path / "templates" / "x.yaml"
    tpl.parent.mkdir(parents=True, exist_ok=True)
    tpl.write_bytes(b"id: x\nsections: []\n")

    fake_yaml = tmp_path / ".solaire" / "build.yaml"
    fake_yaml.write_text("k: v\n", encoding="utf-8")

    monkeypatch.setattr(exam_tools, "write_build_exam_yaml", lambda project_root, **kwargs: fake_yaml)
    monkeypatch.setattr(exam_tools, "run_validate", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        exam_tools,
        "load_template",
        lambda p: MagicMock(sections=[], metadata_defaults={}),
    )
    monkeypatch.setattr(
        exam_tools,
        "export_pdfs",
        lambda project_root, **kwargs: (kwargs["dest_dir"], "stu.pdf", "tea.pdf"),
    )
    monkeypatch.setattr(
        exam_tools,
        "find_export_conflict",
        lambda *args, **kwargs: {"conflict": False},
    )
    monkeypatch.setattr(exam_tools, "snapshot_build_yaml_before_export", lambda root: None)
    monkeypatch.setattr(exam_tools, "restore_build_yaml_from_backup", lambda *a, **k: None)
    monkeypatch.setattr(exam_tools, "discard_build_yaml_backup", lambda *a, **k: None)

    marked: list[str] = []
    monkeypatch.setattr(exam_tools, "mark_exported", lambda root, eid: marked.append(str(eid)))

    ctx = InvocationContext(
        project_root=tmp_path,
        session_id="s1",
        session=SessionState(session_id="s1"),
    )
    args = {
        "template_ref": "x",
        "template_path": "templates/x.yaml",
        "selected_items": [{"section_id": "s1", "question_ids": ["q1"]}],
        "export_label": "测试卷",
        "subject": "数学",
    }
    tr = exam_tools.tool_export_paper(ctx, args)
    assert tr.status == "succeeded"
    assert marked, "mark_exported should run after successful export"
    assert "测试卷" in marked[0] or "/" in marked[0]
