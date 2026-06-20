from __future__ import annotations

import subprocess
import zipfile
from pathlib import Path
from unittest.mock import MagicMock
from xml.etree import ElementTree as ET

import pytest
import yaml
from fastapi.testclient import TestClient

import solaire.web.app as app_module
from solaire.exam_compiler.pipeline import docx as docx_pipeline
from solaire.exam_compiler.pipeline.docx import PandocError, build_exam_docx
from solaire.web.exam_service import export_docx
from solaire.web.result_service import find_exported_docx_path


def _write_minimal_exam_project(root: Path) -> Path:
    tpl = root / "templates" / "template.yaml"
    tpl.parent.mkdir(parents=True, exist_ok=True)
    tpl.write_text(
        yaml.safe_dump(
            {
                "template_id": "t1",
                "layout": "single_column",
                "sections": [
                    {
                        "section_id": "Choice",
                        "type": "single_choice",
                        "required_count": 1,
                        "score_per_item": 5,
                    }
                ],
                "metadata_defaults": {"school": "Example School", "show_name_column": True},
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    lib = root / "resource" / "math" / "set"
    lib.mkdir(parents=True, exist_ok=True)
    (lib / "existing.png").write_bytes(b"not-a-real-png-but-copied")
    (lib / "q1.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "q1",
                "type": "single_choice",
                "content": "Compute $x_1+1$ and $y=\\e^x+\\dlim_{n\\to\\infty} a_n+\\arccot x$.\n:::EMBED_IMG:math/set/existing.png:::",
                "options": {"A": "$1$", "B": "$2$"},
                "answer": "A",
                "analysis": "Because $x_1=0$.",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    exam_yaml = root / "exam.yaml"
    exam_yaml.write_text(
        yaml.safe_dump(
            {
                "exam_id": "exam1",
                "template_ref": "t1",
                "template_path": "templates/template.yaml",
                "metadata": {"title": "Docx Test", "subject": "Math"},
                "question_libraries": [{"namespace": "math/set", "path": "resource/math/set"}],
                "selected_items": [{"section_id": "Choice", "question_ids": ["math/set/q1"]}],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return exam_yaml


def test_build_exam_docx_generates_student_and_teacher_markdown(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    exam_yaml = _write_minimal_exam_project(tmp_path)

    def fake_run_pandoc(md_path: Path, docx_path: Path, *, pandoc_path: str | None = None) -> None:
        docx_path.write_bytes(b"fake docx")

    monkeypatch.setattr(docx_pipeline, "_run_pandoc", fake_run_pandoc)

    student_docx, teacher_docx = build_exam_docx(exam_yaml, tmp_path / "out")

    assert student_docx.is_file()
    assert teacher_docx.is_file()
    work = tmp_path / "exam" / "docx"
    student_md = (work / "student_paper.md").read_text(encoding="utf-8")
    teacher_md = (work / "teacher_paper.md").read_text(encoding="utf-8")
    assert "# Docx Test" in student_md
    assert "$x_1+1$" in student_md
    assert r"$y=\mathrm{e}^x+\displaystyle\lim_{n\to\infty} a_n+\operatorname{arccot} x$" in student_md
    assert r"\e^x" not in student_md
    assert "![](media/" in student_md
    assert "【答案】" not in student_md
    assert "【答案】" in teacher_md
    assert "Because $x_1=0$." in teacher_md
    assert any((work / "media").glob("*.png"))



def test_docx_math_macro_normalization_matches_pdf_common_macros() -> None:
    text = r"before \$3 and $y=\e^x+\i+\dlim_{n\to\infty} a_n+\arccot x+\epsilon$ after"

    normalized = docx_pipeline._normalize_docx_math_macros(text)

    assert r"\$3" in normalized
    assert r"\mathrm{e}^x" in normalized
    assert r"\mathrm{i}" in normalized
    assert r"\displaystyle\lim" in normalized
    assert r"\operatorname{arccot}" in normalized
    assert r"\epsilon" in normalized
    assert r"\e^x" not in normalized


def test_run_pandoc_uses_gaokao_reference_docx(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    md_path = tmp_path / "paper.md"
    docx_path = tmp_path / "paper.docx"
    ref_paths: list[Path] = []
    commands: list[list[str]] = []
    md_path.write_text("# Title\n\nBody", encoding="utf-8")

    def fake_reference(reference_docx: Path, pandoc: str) -> Path:
        assert pandoc == "pandoc"
        reference_docx.write_bytes(b"fake reference")
        ref_paths.append(reference_docx)
        return reference_docx

    def fake_run(cmd: list[str], **kwargs):
        commands.append(cmd)
        docx_path.write_bytes(b"fake docx")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(docx_pipeline, "resolve_exe", lambda *_: "pandoc")
    monkeypatch.setattr(docx_pipeline, "_ensure_gaokao_reference_docx", fake_reference)
    monkeypatch.setattr(docx_pipeline.subprocess, "run", fake_run)

    docx_pipeline._run_pandoc(md_path, docx_path)

    assert docx_path.is_file()
    assert ref_paths == [tmp_path / "gaokao_reference.docx"]
    assert commands and "--reference-doc" in commands[0]
    ref_arg = commands[0][commands[0].index("--reference-doc") + 1]
    assert ref_arg.endswith("gaokao_reference.docx")

def test_gaokao_reference_patch_sets_exam_typography(tmp_path: Path) -> None:
    ref = tmp_path / "reference.docx"
    styles_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{docx_pipeline._W_NS}">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>
  <w:style w:type="table" w:styleId="Table"><w:name w:val="Table"/></w:style>
</w:styles>'''
    document_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{docx_pipeline._W_NS}"><w:body><w:p/><w:sectPr/></w:body></w:document>'''
    with zipfile.ZipFile(ref, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/styles.xml", styles_xml.encode("utf-8"))
        z.writestr("word/document.xml", document_xml.encode("utf-8"))

    docx_pipeline._patch_reference_docx(ref)

    def w(name: str) -> str:
        return f"{{{docx_pipeline._W_NS}}}{name}"

    with zipfile.ZipFile(ref, "r") as z:
        styles_root = ET.fromstring(z.read("word/styles.xml"))
        document_root = ET.fromstring(z.read("word/document.xml"))
    normal = next(
        style for style in styles_root.findall(w("style")) if style.get(w("styleId")) == "Normal"
    )
    normal_fonts = normal.find(f"{w('rPr')}/{w('rFonts')}")
    normal_size = normal.find(f"{w('rPr')}/{w('sz')}")
    assert normal_fonts is not None and normal_fonts.get(w("eastAsia")) == "SimSun"
    assert normal_size is not None and normal_size.get(w("val")) == "21"

    heading = next(
        style for style in styles_root.findall(w("style")) if style.get(w("styleId")) == "Heading1"
    )
    heading_fonts = heading.find(f"{w('rPr')}/{w('rFonts')}")
    heading_jc = heading.find(f"{w('pPr')}/{w('jc')}")
    assert heading_fonts is not None and heading_fonts.get(w("eastAsia")) == "SimHei"
    assert heading_jc is not None and heading_jc.get(w("val")) == "center"

    pg_sz = document_root.find(f".//{w('sectPr')}/{w('pgSz')}")
    pg_mar = document_root.find(f".//{w('sectPr')}/{w('pgMar')}")
    assert pg_sz is not None and pg_sz.get(w("w")) == "11906"
    assert pg_mar is not None and pg_mar.get(w("left")) == "1021"


def test_export_docx_names_files_and_keeps_existing_pdf(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    exam_yaml = tmp_path / ".solaire" / "build.yaml"
    exam_yaml.parent.mkdir(parents=True)
    exam_yaml.write_text(
        yaml.safe_dump(
            {
                "exam_id": "web_export",
                "template_ref": "t1",
                "metadata": {"title": "T"},
                "question_libraries": [],
                "selected_items": [{"section_id": "s1", "question_ids": []}],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    dest = tmp_path / "exams" / "Label" / "Math"
    dest.mkdir(parents=True)
    (dest / "old.docx").write_bytes(b"old")
    (dest / "Label-Math-学生版.docx").write_bytes(b"old student")
    (dest / "Label-Math-教师版.docx").write_bytes(b"old teacher")
    (dest / "keep.pdf").write_bytes(b"pdf")

    def fake_build(exam_yaml: Path, out_dir: Path | None, *, clean_workdir: bool = False):
        assert out_dir == dest
        s = dest / "student_paper.docx"
        t = dest / "teacher_paper.docx"
        s.write_bytes(b"student")
        t.write_bytes(b"teacher")
        return s, t

    monkeypatch.setattr("solaire.web.exam_service.build_exam_docx", fake_build)
    result_dir, student_name, teacher_name = export_docx(
        tmp_path,
        exam_yaml=exam_yaml,
        export_label="Label",
        subject="Math",
        template=MagicMock(sections=[]),
        dest_dir=dest,
    )

    assert result_dir == dest.resolve()
    assert student_name == "Label-Math-学生版.docx"
    assert teacher_name == "Label-Math-教师版.docx"
    assert (dest / student_name).read_bytes() == b"student"
    assert (dest / teacher_name).read_bytes() == b"teacher"
    assert (dest / "keep.pdf").is_file()
    assert (dest / "old.docx").read_bytes() == b"old"
    assert (dest / "exam.yaml").is_file()


def test_export_docx_preserves_old_docx_when_pandoc_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    exam_yaml = tmp_path / ".solaire" / "build.yaml"
    exam_yaml.parent.mkdir(parents=True)
    exam_yaml.write_text(
        yaml.safe_dump(
            {
                "exam_id": "web_export",
                "template_ref": "t1",
                "metadata": {},
                "question_libraries": [],
                "selected_items": [],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    dest = tmp_path / "exams" / "Label" / "Math"
    dest.mkdir(parents=True)
    old = dest / "Label-Math-学生版.docx"
    old.write_bytes(b"old")

    def fake_build(*args, **kwargs):
        raise PandocError("missing pandoc")

    monkeypatch.setattr("solaire.web.exam_service.build_exam_docx", fake_build)
    with pytest.raises(RuntimeError, match="missing pandoc"):
        export_docx(
            tmp_path,
            exam_yaml=exam_yaml,
            export_label="Label",
            subject="Math",
            template=None,
            dest_dir=dest,
        )
    assert old.read_bytes() == b"old"


def test_find_exported_docx_path_by_variant(tmp_path: Path) -> None:
    dest = tmp_path / "exams" / "Label" / "Math"
    dest.mkdir(parents=True)
    student = dest / "Label-Math-学生版.docx"
    teacher = dest / "Label-Math-教师版.docx"
    student.write_bytes(b"s")
    teacher.write_bytes(b"t")
    assert find_exported_docx_path(tmp_path, "Label/Math", variant="student") == student
    assert find_exported_docx_path(tmp_path, "Label/Math", variant="teacher") == teacher


def test_export_word_api_returns_docx_names(
    web_client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = tmp_path.resolve()
    tpl = root / "templates" / "t.yaml"
    tpl.parent.mkdir(parents=True, exist_ok=True)
    tpl.write_text("template_id: t1\nsections: []\n", encoding="utf-8")
    fake_yaml = root / ".solaire" / "build.yaml"
    fake_yaml.parent.mkdir(parents=True, exist_ok=True)
    fake_yaml.write_text("exam_id: web_export\ntemplate_ref: t1\nselected_items: []\n", encoding="utf-8")

    monkeypatch.setattr(app_module, "write_build_exam_yaml", lambda project_root, **kwargs: fake_yaml)
    monkeypatch.setattr(app_module, "run_validate", lambda *args, **kwargs: None)
    monkeypatch.setattr(app_module, "load_template", lambda p: MagicMock(sections=[]))
    monkeypatch.setattr(
        app_module,
        "export_docx",
        lambda project_root, **kwargs: (kwargs["dest_dir"], "stu.docx", "tea.docx"),
    )
    monkeypatch.setattr(app_module, "snapshot_build_yaml_before_export", lambda root: None)
    monkeypatch.setattr(app_module, "discard_build_yaml_backup", lambda backup: None)
    monkeypatch.setattr(app_module, "mark_exported", lambda *args, **kwargs: None)

    r = web_client.post(
        "/api/exam/export-word",
        json={
            "template_ref": "t1",
            "template_path": "templates/t.yaml",
            "selected_items": [],
            "export_label": "Label",
            "subject": "Math",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["student_docx"] == "stu.docx"
    assert r.json()["teacher_docx"] == "tea.docx"


def test_docx_file_and_open_docx_api(
    web_client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = tmp_path.resolve()
    dest = root / "exams" / "Label" / "Math"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "Label-Math-学生版.docx").write_bytes(b"student")
    (dest / "Label-Math-教师版.docx").write_bytes(b"teacher")

    r = web_client.get("/api/exams/Label%2FMath/docx-file?variant=student")
    assert r.status_code == 200, r.text
    assert r.content == b"student"
    assert "wordprocessingml.document" in r.headers["content-type"]

    opened: list[Path] = []
    monkeypatch.setattr(app_module, "open_docx_with_default_app", lambda path: opened.append(path))
    r2 = web_client.post("/api/exams/Label%2FMath/open-docx", json={"variant": "teacher"})
    assert r2.status_code == 200, r2.text
    assert opened and opened[0].name.endswith("教师版.docx")
