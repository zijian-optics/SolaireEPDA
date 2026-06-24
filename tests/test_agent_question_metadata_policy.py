from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "src" / "solaire" / "agent_layer" / "skills" / "create-question-yaml" / "SKILL.md"
REFERENCE = SKILL.parent / "references" / "yaml-template.md"


def test_create_question_skill_documents_default_metadata_policy() -> None:
    text = SKILL.read_text(encoding="utf-8")
    reference = REFERENCE.read_text(encoding="utf-8")
    required_fields = ["难度", "来源", "年份", "题目用途", "难度评分", "创新性"]

    for field in required_fields:
        assert field in text
        assert field in reference

    assert "graph.search_nodes" in text
    assert "graph.bind_question" in text
    assert "唯一" in text
    assert "不要把知识点/核心考点重复写进 metadata" in text
