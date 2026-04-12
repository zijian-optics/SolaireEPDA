"""Rename / delete question collection directories under resource/."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from solaire.exam_compiler.models import QuestionItem
from solaire.web.bank_service import delete_question_collection, import_merged_yaml, rename_question_collection


def _q() -> QuestionItem:
    return QuestionItem(
        id="q1",
        type="choice",
        content="x",
        answer="A",
        analysis="",
        options={"A": "a", "B": "b", "C": "c", "D": "d"},
        metadata={},
    )


def test_rename_collection_moves_directory(tmp_path: Path) -> None:
    root = tmp_path
    yml = yaml.safe_dump({"questions": [_q().model_dump(mode="json")]}, allow_unicode=True, sort_keys=False)
    import_merged_yaml(root, yml, "数学", "旧题集")
    old = root / "resource" / "数学" / "旧题集"
    assert old.is_dir()
    assert any(old.glob("*.yaml"))

    r = rename_question_collection(root, namespace="数学/旧题集", new_subject="数学", new_collection="新题集")
    assert r["changed"] is True
    assert r["namespace"] == "数学/新题集"
    assert not old.exists()
    new = root / "resource" / "数学" / "新题集"
    assert new.is_dir()
    assert any(new.glob("*.yaml"))


def test_rename_rejects_main(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="不能重命名"):
        rename_question_collection(tmp_path, namespace="main", new_subject="a", new_collection="b")


def test_delete_collection_removes_directory(tmp_path: Path) -> None:
    root = tmp_path
    yml = yaml.safe_dump({"questions": [_q().model_dump(mode="json")]}, allow_unicode=True, sort_keys=False)
    import_merged_yaml(root, yml, "物理", "练习")
    d = root / "resource" / "物理" / "练习"
    assert d.is_dir()
    delete_question_collection(root, "物理/练习")
    assert not d.exists()


def test_delete_rejects_main(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="不能删除"):
        delete_question_collection(tmp_path, "main")
