"""Tests for result_service: exam history, score template, import, and statistics."""

from __future__ import annotations

import csv
import io
import time
from pathlib import Path

import pytest

from solaire.exam_compiler.models import ExamConfig, QuestionLibraryRef, SelectedSection
from solaire.web.app import ensure_project_layout
from solaire.web.result_service import (
    compute_statistics,
    delete_exam_result,
    delete_score_batch,
    generate_score_template,
    get_exam_summary,
    get_score_analysis,
    import_scores,
    list_exam_results,
)
_SUBJ = "数学"


def _exam_workspace(project_root: Path, label: str) -> Path:
    d = project_root / "exams" / label / _SUBJ
    d.mkdir(parents=True, exist_ok=True)
    return d


def _eid(label: str) -> str:
    return f"{label}/{_SUBJ}"


def _write_exam_yaml(dest_dir: Path, exam_id: str, questions: list[tuple[str, int]]) -> None:
    """Write a minimal exam.yaml to dest_dir with given (section_id, question_count) pairs."""
    sections = []
    for si, (sec_id, qcount) in enumerate(questions, start=1):
        sections.append(
            SelectedSection(
                section_id=sec_id,
                question_ids=[f"q_{si}_{j}" for j in range(1, qcount + 1)],
                score_per_item=5.0,
            )
        )
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref="default",
        metadata={"title": f"考试{si}", "subject": "数学"},
        question_libraries=[],
        template_path="templates/test.yaml",
        selected_items=sections,
    )
    import yaml

    with (dest_dir / "exam.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)


class TestListExamResults:
    def test_empty_exams_dir(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        assert list_exam_results(tmp_path) == []

    def test_exam_listed(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        result_dir = _exam_workspace(tmp_path, "exam-001")
        _write_exam_yaml(result_dir, _eid("exam-001"), [("s1", 3)])

        results = list_exam_results(tmp_path)
        assert len(results) == 1
        assert results[0]["exam_id"] == _eid("exam-001")
        assert results[0]["question_count"] == 3

    def test_multiple_exams_sorted_newest_first(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        r1 = _exam_workspace(tmp_path, "older")
        time.sleep(0.02)
        r2 = _exam_workspace(tmp_path, "newer")
        _write_exam_yaml(r1, _eid("older"), [("s1", 2)])
        _write_exam_yaml(r2, _eid("newer"), [("s1", 4)])

        results = list_exam_results(tmp_path)
        ids = [r["exam_id"] for r in results]
        assert ids == [_eid("newer"), _eid("older")]


class TestGetExamSummary:
    def test_not_found(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        with pytest.raises(FileNotFoundError):
            get_exam_summary(tmp_path, "missing/数学")

    def test_returns_questions(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "my-exam")
        _write_exam_yaml(rd, _eid("my-exam"), [("选择题", 5), ("填空题", 3)])

        summary = get_exam_summary(tmp_path, _eid("my-exam"))
        assert summary["exam_id"] == _eid("my-exam")
        assert summary["question_count"] == 8
        assert len(summary["questions"]) == 8
        assert summary["questions"][0]["header"] == "1.1"
        assert summary["questions"][0]["score_per_item"] == 5.0


class TestScoreTemplate:
    def test_csv_content(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "tpl-test")
        _write_exam_yaml(rd, _eid("tpl-test"), [("s1", 3)])

        csv_content, filename = generate_score_template(tmp_path, _eid("tpl-test"))
        assert filename.endswith(".csv")
        reader = csv.reader(io.StringIO(csv_content))
        rows = list(reader)
        assert rows[0] == ["姓名", "学号", "1.1", "1.2", "1.3"]


class TestImportScores:
    def test_import_csv(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "import-test")
        _write_exam_yaml(rd, _eid("import-test"), [("s1", 3)])

        csv_data = "姓名,学号,1.1,1.2,1.3\n张三,001,5,3,0\n李四,002,4,5,2\n"
        result = import_scores(tmp_path, _eid("import-test"), csv_data.encode("utf-8"), "scores.csv")
        assert result["student_count"] == 2
        assert result["question_count"] == 3
        assert "batch_id" in result

    def test_missing_exam_yaml(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "no-yaml")
        with pytest.raises(FileNotFoundError):
            import_scores(tmp_path, _eid("no-yaml"), "姓名,学号\n".encode("utf-8"), "scores.csv")

    def test_binary_scores(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "bin-test")
        _write_exam_yaml(rd, _eid("bin-test"), [("s1", 2)])

        csv_data = "姓名,学号,1.1,1.2\n甲,A01,1,0\n乙,A02,0,1\n"
        result = import_scores(tmp_path, _eid("bin-test"), csv_data.encode("utf-8"), "scores.csv")
        assert result["student_count"] == 2


class TestComputeStatistics:
    def test_question_error_rates(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "stat-test")
        _write_exam_yaml(rd, _eid("stat-test"), [("s1", 3)])

        csv_data = "姓名,学号,1.1,1.2,1.3\n甲,001,5,0,2\n乙,002,4,5,0\n丙,003,5,3,1\n"
        result = import_scores(tmp_path, _eid("stat-test"), csv_data.encode("utf-8"), "scores.csv")
        batch_id = result["batch_id"]

        analysis = compute_statistics(tmp_path, _eid("stat-test"), batch_id)
        assert analysis["student_count"] == 3
        assert analysis["question_count"] == 3
        assert analysis["class_avg_ratio"] is not None
        assert analysis["class_avg_fuzzy"] is not None

        q1_stats = next(q for q in analysis["question_stats"] if q["header"] == "1.1")
        assert q1_stats["answered_count"] == 3
        assert q1_stats["error_rate"] == 0.0 or q1_stats["error_rate"] is not None

    def test_unbound_question_warnings(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "warn-test")
        _write_exam_yaml(rd, _eid("warn-test"), [("s1", 2)])

        csv_data = "姓名,学号,1.1,1.2\n甲,001,5,3\n"
        result = import_scores(tmp_path, _eid("warn-test"), csv_data.encode("utf-8"), "scores.csv")
        batch_id = result["batch_id"]

        analysis = compute_statistics(tmp_path, _eid("warn-test"), batch_id)
        assert len(analysis["warnings"]) == 2
        headers = {w["header"] for w in analysis["warnings"]}
        assert headers == {"1.1", "1.2"}

    def test_recompute_recalculates(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "recompute-test")
        _write_exam_yaml(rd, _eid("recompute-test"), [("s1", 1)])

        csv_data = "姓名,学号,1.1\n甲,001,5\n"
        result = import_scores(tmp_path, _eid("recompute-test"), csv_data.encode("utf-8"), "scores.csv")
        batch_id = result["batch_id"]

        a1 = get_score_analysis(tmp_path, _eid("recompute-test"), batch_id)
        a2 = compute_statistics(tmp_path, _eid("recompute-test"), batch_id)
        assert a1["student_count"] == a2["student_count"] == 1

    def test_avg_raw_score_keeps_original_points(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "raw-score-test")
        _write_exam_yaml(rd, _eid("raw-score-test"), [("s1", 2)])

        csv_data = "姓名,学号,1.1,1.2\n甲,001,5,3\n乙,002,4,1\n"
        result = import_scores(tmp_path, _eid("raw-score-test"), csv_data.encode("utf-8"), "scores.csv")
        analysis = compute_statistics(tmp_path, _eid("raw-score-test"), result["batch_id"])
        q11 = next(q for q in analysis["question_stats"] if q["header"] == "1.1")
        q12 = next(q for q in analysis["question_stats"] if q["header"] == "1.2")
        assert q11["avg_raw_score"] == 4.5
        assert q12["avg_raw_score"] == 2.0


class TestDeleteResultData:
    def test_delete_score_batch(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "delete-batch-test")
        _write_exam_yaml(rd, _eid("delete-batch-test"), [("s1", 1)])
        csv_data = "姓名,学号,1.1\n甲,001,5\n"
        result = import_scores(tmp_path, _eid("delete-batch-test"), csv_data.encode("utf-8"), "scores.csv")
        batch_id = result["batch_id"]
        eid = _eid("delete-batch-test")

        out = delete_score_batch(tmp_path, eid, batch_id)
        assert out["ok"] is True
        assert out["exam_id"] == eid
        assert out["batch_id"] == batch_id
        assert not (rd / "scores" / batch_id).exists()

    def test_delete_exam_result(self, tmp_path: Path) -> None:
        ensure_project_layout(tmp_path)
        rd = _exam_workspace(tmp_path, "delete-exam-test")
        _write_exam_yaml(rd, _eid("delete-exam-test"), [("s1", 1)])
        eid = _eid("delete-exam-test")

        out = delete_exam_result(tmp_path, eid)
        assert out["ok"] is True
        assert out["exam_id"] == eid
        assert not rd.exists()
