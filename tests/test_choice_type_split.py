from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
import yaml

from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.models import ExamConfig, ExamTemplate, QuestionItem, QuestionLibraryRef, SelectedSection
from solaire.exam_compiler.pipeline.validate import validate_exam
from solaire.web.bank_exchange import import_bank_exchange_zip
from solaire.web.bank_service import import_merged_yaml


def _choice_payload(qid: str, answer: str) -> dict[str, object]:
    return {
        "id": qid,
        "type": "choice",
        "content": "stem",
        "options": {"A": "a", "B": "b", "C": "c", "D": "d"},
        "answer": answer,
        "analysis": "",
        "metadata": {},
    }


def test_legacy_choice_question_type_is_inferred_from_answer() -> None:
    single = QuestionItem.model_validate(_choice_payload("q1", "A"))
    multiple = QuestionItem.model_validate(_choice_payload("q2", "A,C"))

    assert single.type == "single_choice"
    assert multiple.type == "multiple_choice"


def test_merged_import_writes_normalized_choice_types(tmp_path: Path) -> None:
    merged = yaml.safe_dump(
        {"questions": [_choice_payload("single", "A"), _choice_payload("multi", "AC")]},
        allow_unicode=True,
        sort_keys=False,
    )

    import_merged_yaml(tmp_path, merged, "math", "unit")

    single = yaml.safe_load((tmp_path / "resource" / "math" / "unit" / "single.yaml").read_text(encoding="utf-8"))
    multi = yaml.safe_load((tmp_path / "resource" / "math" / "unit" / "multi.yaml").read_text(encoding="utf-8"))
    assert single["type"] == "single_choice"
    assert multi["type"] == "multiple_choice"


def test_strict_zip_import_normalizes_per_file_yaml(tmp_path: Path) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("yaml/q.yaml", yaml.safe_dump(_choice_payload("q", "BD"), allow_unicode=True, sort_keys=False))

    import_bank_exchange_zip(tmp_path, buf.getvalue(), "math", "unit")

    raw = yaml.safe_load((tmp_path / "resource" / "math" / "unit" / "q.yaml").read_text(encoding="utf-8"))
    assert raw["type"] == "multiple_choice"


def test_validate_exam_splits_single_and_multiple_choice_sections() -> None:
    template = ExamTemplate(
        template_id="tpl",
        sections=[
            {"section_id": "single", "type": "single_choice", "required_count": 1, "score_per_item": 1},
            {"section_id": "multi", "type": "multiple_choice", "required_count": 1, "score_per_item": 1},
            {"section_id": "legacy", "type": "choice", "required_count": 2, "score_per_item": 1},
        ],
    )
    loaded = LoadedQuestions(
        by_qualified={
            "bank/q1": QuestionItem.model_validate(_choice_payload("q1", "A")),
            "bank/q2": QuestionItem.model_validate(_choice_payload("q2", "AC")),
        }
    )
    exam = ExamConfig(
        exam_id="exam",
        template_ref="tpl",
        question_libraries=[QuestionLibraryRef(path="resource/math/unit", namespace="bank")],
        selected_items=[
            SelectedSection(section_id="single", question_ids=["bank/q1"]),
            SelectedSection(section_id="multi", question_ids=["bank/q2"]),
            SelectedSection(section_id="legacy", question_ids=["bank/q1", "bank/q2"]),
        ],
    )

    validate_exam(exam, template, loaded)

    wrong = exam.model_copy(
        update={
            "selected_items": [
                SelectedSection(section_id="single", question_ids=["bank/q2"]),
                SelectedSection(section_id="multi", question_ids=["bank/q1"]),
                SelectedSection(section_id="legacy", question_ids=["bank/q1", "bank/q2"]),
            ]
        }
    )
    with pytest.raises(ValueError):
        validate_exam(wrong, template, loaded)
