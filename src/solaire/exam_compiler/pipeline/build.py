"""End-to-end: load → validate → hydrate → render → latexmk → copy PDFs."""

from __future__ import annotations

import shutil
from pathlib import Path

import yaml

from solaire.exam_compiler.loaders.questions import load_all_questions
from solaire.exam_compiler.loaders.template_loader import load_template, resolve_template_yaml_path
from solaire.exam_compiler.models import ExamConfig
from solaire.exam_compiler.paths import exam_parent_dir, work_dir_for_exam
from solaire.exam_compiler.pipeline.compile_tex import (
    LatexmkError,
    clean_latex_intermediates,
    copy_pdf_if_exists,
    run_latexmk,
)
from solaire.exam_compiler.pipeline.hydrate import hydrate
from solaire.exam_compiler.pipeline.render import write_student_teacher_tex
from solaire.exam_compiler.pipeline.validate import normalize_exam_for_preview, validate_exam, validate_exam_preview


def _parse_exam(exam_yaml: Path) -> ExamConfig:
    with exam_yaml.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    return ExamConfig.model_validate(raw)


def _compile_exam_tex_to_pdfs(
    exam_yaml: Path,
    *,
    clean_workdir: bool = False,
    preview_relaxed: bool = False,
) -> tuple[Path, Path, Path, list[str]]:
    """Returns (work_dir, student_pdf, teacher_pdf, preview_warnings). preview_warnings only when preview_relaxed."""
    exam_yaml = exam_yaml.resolve()
    if not exam_yaml.is_file():
        raise FileNotFoundError(exam_yaml)

    exam = _parse_exam(exam_yaml)
    if not exam.question_libraries:
        raise ValueError("exam.yaml must include non-empty question_libraries")

    libs = [(lib.namespace, lib.path) for lib in exam.question_libraries]
    loaded = load_all_questions(exam_yaml, libs)

    tmpl_path = resolve_template_yaml_path(exam_yaml, exam)
    template = load_template(tmpl_path)
    preview_warnings: list[str] = []
    if preview_relaxed:
        exam, preview_warnings = normalize_exam_for_preview(exam, template)
        validate_exam_preview(exam, template, loaded)
        with exam_yaml.open("w", encoding="utf-8") as f:
            yaml.safe_dump(exam.model_dump(mode="json"), f, allow_unicode=True, sort_keys=False)
    else:
        validate_exam(exam, template, loaded)

    hydrated = hydrate(exam, template, loaded)
    work_dir = work_dir_for_exam(exam_yaml)
    if clean_workdir and work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    template_yaml_dir = tmpl_path.parent
    write_student_teacher_tex(hydrated, template_yaml_dir, template.latex_base, work_dir, loaded)
    clean_latex_intermediates(work_dir)

    student_tex = work_dir / "student_paper.tex"
    teacher_tex = work_dir / "teacher_paper.tex"

    run_latexmk(work_dir, student_tex)
    run_latexmk(work_dir, teacher_tex)

    student_pdf = work_dir / "student_paper.pdf"
    teacher_pdf = work_dir / "teacher_paper.pdf"
    if not student_pdf.is_file() or not teacher_pdf.is_file():
        raise LatexmkError("latexmk reported success but PDF not found.")
    return work_dir, student_pdf, teacher_pdf, preview_warnings


def precheck_exam_latex_build(exam_yaml: Path, *, clean_workdir: bool = False) -> None:
    """Run hydrate → write TeX → latexmk for student+teacher; raises LatexmkError on failure."""
    _compile_exam_tex_to_pdfs(exam_yaml, clean_workdir=clean_workdir, preview_relaxed=False)


def build_exam_pdfs(
    exam_yaml: Path,
    out_dir: Path | None,
    *,
    clean_workdir: bool = False,
    preview_relaxed: bool = False,
) -> tuple[Path, Path, list[str]]:
    """
    Build student and teacher PDFs.

    Returns paths to copied PDFs in the output directory (default: same dir as exam.yaml),
    and preview warning lines (empty unless preview_relaxed).
    """
    work_dir, student_pdf, teacher_pdf, preview_warnings = _compile_exam_tex_to_pdfs(
        exam_yaml, clean_workdir=clean_workdir, preview_relaxed=preview_relaxed
    )
    dest = out_dir if out_dir is not None else exam_parent_dir(exam_yaml)
    dest = dest.resolve()
    student_out = copy_pdf_if_exists(work_dir, "student_paper", dest)
    teacher_out = copy_pdf_if_exists(work_dir, "teacher_paper", dest)
    return student_out, teacher_out, preview_warnings
