"""Regression: POST /api/exams 落盘为 exams/<试卷说明>/<学科>/，而非单层随机目录。"""

from __future__ import annotations

import solaire.web.state as st
from fastapi.testclient import TestClient
from solaire.web.exam_workspace_service import _fill_identity_from_exam_path_fields, _norm_template_path_rel


def test_norm_template_path_rel_strips_parent_segments() -> None:
    """exam.yaml 中相对考试目录的 ``../templates/…`` 应规范为与模板列表一致的 ``templates/…``。"""
    assert _norm_template_path_rel("../templates/gaokao2024.yaml") == "templates/gaokao2024.yaml"
    assert _norm_template_path_rel("templates/x.yaml") == "templates/x.yaml"


def test_fill_identity_from_exam_path_fields() -> None:
    d = {"export_label": "", "subject": ""}
    _fill_identity_from_exam_path_fields(d, "高考数学/数学")
    assert d["export_label"] == "高考数学"
    assert d["subject"] == "数学"
    d2 = {"export_label": "期中", "subject": "物理"}
    _fill_identity_from_exam_path_fields(d2, "高考数学/数学")
    assert d2["export_label"] == "期中"
    assert d2["subject"] == "物理"


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


def test_get_exams_returns_canonical_exam_id_despite_stale_yaml(web_client: TestClient) -> None:
    """历史 exam.yaml 内若仍为单段旧 id，GET 仍应返回路径上的双段 exam_id。"""
    root = st.get_root()
    r0 = web_client.post(
        "/api/exams",
        json={
            "name": None,
            "export_label": "期中",
            "subject": "物理",
            "template_ref": "t1",
            "template_path": "templates/minimal.yaml",
            "selected_items": [{"section_id": "s1", "question_ids": []}],
        },
    )
    assert r0.status_code == 200, r0.text
    yp = root / "exams" / "期中" / "物理" / "exam.yaml"
    assert yp.is_file()
    raw = yp.read_text(encoding="utf-8")
    yp.write_text(raw.replace("exam_id: 期中/物理", "exam_id: deadbeefdeadbeefdeadbeefdeadbeef"), encoding="utf-8")

    r1 = web_client.get("/api/exams/%E6%9C%9F%E4%B8%AD%2F%E7%89%A9%E7%90%86")
    assert r1.status_code == 200, r1.text
    assert r1.json()["exam"]["exam_id"] == "期中/物理"
