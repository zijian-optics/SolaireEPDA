"""Regression: POST /api/exams 落盘为 exams/<试卷说明>/<学科>/，而非单层随机目录。"""

from __future__ import annotations

import solaire.web.state as st
from fastapi.testclient import TestClient


def test_post_exams_creates_nested_exams_dir(web_client: TestClient) -> None:
    root = st.get_root()

    r = web_client.post(
        "/api/exams",
        json={
            "name": None,
            "export_label": "期中测验",
            "subject": "数学",
            "template_ref": "t1",
            "template_path": "templates/minimal.yaml",
            "selected_items": [{"section_id": "s1", "question_ids": []}],
        },
    )
    assert r.status_code == 200, r.text
    exam = r.json()["exam"]
    assert exam["exam_id"] == "期中测验/数学"

    exam_dir = root / "exams" / "期中测验" / "数学"
    assert exam_dir.is_dir()
    assert (exam_dir / "exam.yaml").is_file()
    assert (exam_dir / "config.json").is_file()
