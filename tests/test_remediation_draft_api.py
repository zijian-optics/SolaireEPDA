"""Remediation draft generation from diagnosis suggestions."""

from __future__ import annotations

from pathlib import Path

import yaml

from solaire.exam_compiler.models import ExamConfig, SelectedSection


def _write_question(path: Path, qid: str, qtype: str = "single_choice") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if qtype == "single_choice":
        raw = {
            "id": qid,
            "type": "single_choice",
            "content": f"{qid} 题干",
            "options": {"A": "1", "B": "2"},
            "answer": "A",
            "analysis": "",
        }
    else:
        raw = {
            "id": qid,
            "type": qtype,
            "content": f"{qid} 题干",
            "answer": "1",
            "analysis": "",
        }
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, allow_unicode=True, sort_keys=False)


def _write_template(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = {
        "template_id": "test_template",
        "layout": "single_column",
        "latex_base": "exam-zh-base.tex.j2",
        "sections": [
            {
                "section_id": "选择题",
                "type": "single_choice",
                "required_count": 2,
                "score_per_item": 5,
            }
        ],
    }
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, allow_unicode=True, sort_keys=False)


def _write_source_exam(
    root: Path,
    exam_id: str,
    question_id: str,
    *,
    template_path: str = "templates/test.yaml",
) -> None:
    exam_dir = root / "exams" / "期中" / "数学"
    exam_dir.mkdir(parents=True, exist_ok=True)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="test_template",
        template_path=template_path,
        metadata={"title": "期中", "subject": "数学", "export_label": "期中"},
        question_libraries=[],
        selected_items=[
            SelectedSection(section_id="选择题", question_ids=[question_id], score_per_item=5)
        ],
    )
    with (exam_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)


def test_create_remediation_draft_excludes_source_exam_questions(web_client, tmp_path: Path) -> None:
    root = tmp_path
    _write_template(root / "templates" / "test.yaml")
    source_qid = "数学/补题/source_choice"
    q1 = "数学/补题/remedial_choice_1"
    q2 = "数学/补题/remedial_choice_2"
    _write_question(root / "resource" / "数学" / "补题" / "source_choice.yaml", "source_choice")
    _write_question(root / "resource" / "数学" / "补题" / "remedial_choice_1.yaml", "remedial_choice_1")
    _write_question(root / "resource" / "数学" / "补题" / "remedial_choice_2.yaml", "remedial_choice_2")

    exam_id = "期中/数学"
    _write_source_exam(root, exam_id, source_qid)

    csv_text = "姓名,学号,1.1\n甲,001,2\n乙,002,1\n"
    files = {"file": ("scores.csv", csv_text.encode("utf-8"), "text/csv")}
    r_import = web_client.post(f"/api/exams/{exam_id}/scores", files=files)
    assert r_import.status_code == 200, r_import.text
    batch_id = r_import.json()["batch_id"]

    node_id = "math/remediation/node"
    assert web_client.post(
        "/api/graph/nodes",
        json={"id": node_id, "canonical_name": "薄弱点", "subject": "数学", "aliases": []},
    ).status_code == 200
    for qid in (source_qid, q1, q2):
        r_bind = web_client.post(
            "/api/graph/bindings",
            json={"question_qualified_id": qid, "node_id": node_id},
        )
        assert r_bind.status_code == 200, r_bind.text

    r_recompute = web_client.post(f"/api/exams/{exam_id}/scores/{batch_id}/recompute", json={})
    assert r_recompute.status_code == 200, r_recompute.text

    r_preview = web_client.get(
        "/api/analysis/remediation-draft-preview",
        params={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "weak_limit": 3,
            "practice_per_node": 5,
            "exclude_source_exam_questions": True,
        },
    )
    assert r_preview.status_code == 200, r_preview.text
    preview = r_preview.json()
    assert preview["selected_count"] == 2
    assert source_qid not in preview["selected_question_ids"]
    assert set(preview["selected_question_ids"]) == {q1, q2}

    r = web_client.post(
        "/api/analysis/remediation-drafts",
        json={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "weak_limit": 3,
            "practice_per_node": 5,
            "exclude_source_exam_questions": True,
            "export_label": "期中补练",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["selected_count"] == 2
    assert body["exam_id"] == "期中补练/数学"
    selected = body["weak_nodes"][0]["selected_question_ids"]
    assert source_qid not in selected
    assert set(selected) == {q1, q2}

    r_get = web_client.get(f"/api/exams/{body['exam_id']}")
    assert r_get.status_code == 200, r_get.text
    doc = r_get.json()
    assert doc["source_exam_id"] == exam_id
    assert doc["template_ref"] == "remediation_practice"
    assert doc["template_path"] == ".solaire/internal_templates/remediation_practice.yaml"
    assert doc["selected_items"][0]["section_id"] == "练习题"
    assert doc["selected_items"][0]["question_ids"] == [q1, q2]


def test_create_remediation_draft_falls_back_to_template_ref_when_path_is_stale(
    web_client,
    tmp_path: Path,
) -> None:
    root = tmp_path
    _write_template(root / "templates" / "actual-template.yaml")
    source_qid = "数学/补题/source_choice"
    q1 = "数学/补题/remedial_choice_1"
    _write_question(root / "resource" / "数学" / "补题" / "source_choice.yaml", "source_choice")
    _write_question(root / "resource" / "数学" / "补题" / "remedial_choice_1.yaml", "remedial_choice_1")

    exam_id = "期末/数学"
    _write_source_exam(root, exam_id, source_qid, template_path="templates/missing-template.yaml")

    csv_text = "姓名,学号,1.1\n甲,001,2\n乙,002,1\n"
    files = {"file": ("scores.csv", csv_text.encode("utf-8"), "text/csv")}
    r_import = web_client.post(f"/api/exams/{exam_id}/scores", files=files)
    assert r_import.status_code == 200, r_import.text
    batch_id = r_import.json()["batch_id"]

    node_id = "math/remediation/stale-template"
    assert web_client.post(
        "/api/graph/nodes",
        json={"id": node_id, "canonical_name": "路径回退点", "subject": "数学", "aliases": []},
    ).status_code == 200
    for qid in (source_qid, q1):
        r_bind = web_client.post(
            "/api/graph/bindings",
            json={"question_qualified_id": qid, "node_id": node_id},
        )
        assert r_bind.status_code == 200, r_bind.text

    r_recompute = web_client.post(f"/api/exams/{exam_id}/scores/{batch_id}/recompute", json={})
    assert r_recompute.status_code == 200, r_recompute.text

    r = web_client.post(
        "/api/analysis/remediation-drafts",
        json={
            "exam_id": exam_id,
            "batch_id": batch_id,
            "exclude_source_exam_questions": True,
            "export_label": "期末补练",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["selected_count"] == 1
    assert r.json()["low_count"] is True

    r_get = web_client.get(f"/api/exams/{r.json()['exam_id']}")
    assert r_get.status_code == 200, r_get.text
    assert r_get.json()["template_path"] == ".solaire/internal_templates/remediation_practice.yaml"
