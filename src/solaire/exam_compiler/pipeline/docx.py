"""Pandoc-backed DOCX export pipeline."""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import yaml

from solaire.exam_compiler.choice_layout import choice_option_pairs, resolve_choice_layout
from solaire.exam_compiler.loaders.questions import LoadedQuestions, load_all_questions
from solaire.exam_compiler.loaders.template_loader import load_template, resolve_template_yaml_path
from solaire.exam_compiler.models import ExamConfig, is_choice_type
from solaire.exam_compiler.paths import exam_parent_dir, work_dir_for_exam
from solaire.exam_compiler.pipeline.diagram_expand import (
    ensure_mermaid_block_files,
    project_root_from_library_root,
)
from solaire.exam_compiler.pipeline.hydrate import HydratedExam, HydratedQuestion, hydrate
from solaire.exam_compiler.pipeline.primebrush_expand import _svg_to_png, ensure_primebrush_block_files
from solaire.exam_compiler.pipeline.validate import validate_exam
from solaire.exam_compiler.qualified_id import namespace_of_qualified
from solaire.web.extension_registry import resolve_exe

_FENCE_RE = re.compile(r"```(primebrush|mermaid)\s*\n(.*?)```", re.DOTALL)
_EMBED_RE = re.compile(r":::EMBED_IMG:([^:]+):::")


class PandocError(RuntimeError):
    """Raised when DOCX export cannot run or Pandoc fails."""

    def __init__(
        self,
        message: str,
        *,
        returncode: int | None = None,
        stdout: str = "",
        stderr: str = "",
    ) -> None:
        super().__init__(message)
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _parse_exam(exam_yaml: Path) -> ExamConfig:
    with exam_yaml.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    return ExamConfig.model_validate(raw)


def _tail(s: str, max_len: int = 2000) -> str:
    s = (s or "").strip()
    if len(s) <= max_len:
        return s
    return s[-max_len:]


def format_pandoc_failure_message(exc: PandocError) -> str:
    """Return a compact user-facing DOCX export failure message."""
    msg = str(exc).strip() or "Pandoc 文档转换失败。"
    if exc.returncode is None and not exc.stdout and not exc.stderr:
        return msg
    details = "\n".join(part for part in (_tail(exc.stderr), _tail(exc.stdout)) if part)
    if not details:
        return f"{msg}（退出码 {exc.returncode}）"
    return f"{msg}\n\n{details}"


def _sanitize_name_part(s: str, default: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9_.-]+", "_", s.strip())
    clean = clean.strip("._")
    return clean or default


def _copy_media(src: Path, media_dir: Path, *, prefix: str) -> str | None:
    src = src.resolve()
    if not src.is_file():
        return None
    media_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(str(src).encode("utf-8")).hexdigest()[:10]
    suffix = src.suffix.lower() or ".png"
    stem = _sanitize_name_part(prefix or src.stem, "image")
    target = media_dir / f"{stem}_{digest}{suffix}"
    if target.resolve() != src:
        shutil.copy2(src, target)
    return f"media/{target.name}"


def _copy_svg_as_png(src: Path, media_dir: Path, *, prefix: str) -> str | None:
    src = src.resolve()
    if not src.is_file():
        return None
    media_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(str(src).encode("utf-8")).hexdigest()[:10]
    stem = _sanitize_name_part(prefix or src.stem, "image")
    target = media_dir / f"{stem}_{digest}.png"
    svg = src.read_text(encoding="utf-8")
    _svg_to_png(svg, target)
    return f"media/{target.name}"


def _markdown_image(rel_path: str | None) -> str:
    if not rel_path:
        return ""
    return f"\n\n![]({rel_path}){{width=80%}}\n\n"


def _library_context(
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
) -> tuple[Path, Path] | None:
    ns = namespace_of_qualified(hq.qualified_id)
    root = loaded.library_roots.get(ns)
    if root is None:
        return None
    try:
        project_root = project_root_from_library_root(root)
    except ValueError:
        return None
    return root, project_root


def _materialize_visuals(
    text: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
) -> str:
    if not text:
        return ""
    ctx = _library_context(hq, loaded)
    if ctx is None:
        return text
    lib_root, project_root = ctx
    image_dir = lib_root / "image"
    primebrush_idx = 0
    mermaid_idx = 0

    def repl_fence(m: re.Match[str]) -> str:
        nonlocal primebrush_idx, mermaid_idx
        kind = m.group(1)
        body = m.group(2)
        if kind == "primebrush":
            stem, png_name = ensure_primebrush_block_files(
                body,
                image_dir=image_dir,
                block_index=primebrush_idx,
                write_png=True,
            )
            primebrush_idx += 1
            rel = _copy_media(image_dir / png_name, media_dir, prefix=stem)
            return _markdown_image(rel)

        stem, png_name = ensure_mermaid_block_files(
            body,
            image_dir=image_dir,
            block_index=mermaid_idx,
            write_png=True,
        )
        mermaid_idx += 1
        rel = _copy_media(image_dir / png_name, media_dir, prefix=stem)
        return _markdown_image(rel)

    out = _FENCE_RE.sub(repl_fence, text)

    def repl_embed(m: re.Match[str]) -> str:
        rel = m.group(1).strip()
        if not rel or ".." in rel or rel.startswith(("/", "\\")):
            return m.group(0)
        res_root = (project_root / "resource").resolve()
        src = (res_root / rel).resolve()
        try:
            src.relative_to(res_root)
        except ValueError:
            return m.group(0)
        if not src.is_file():
            return m.group(0)
        if src.suffix.lower() == ".svg":
            copied = _copy_svg_as_png(src, media_dir, prefix=src.stem)
        else:
            copied = _copy_media(src, media_dir, prefix=src.stem)
        return _markdown_image(copied)

    return _EMBED_RE.sub(repl_embed, out)


def _clean_latex_for_markdown(text: str) -> str:
    if not text:
        return ""
    out = text.replace("\r\n", "\n")
    out = re.sub(r"\\underline\{\\hspace\{[^{}]*\}\}", "________", out)
    out = re.sub(r"\\hspace\{[^{}]*\}", "____", out)
    out = re.sub(r"\\vspace\{[^{}]*\}", "\n\n", out)
    out = re.sub(r"\\(?:par|smallskip|medskip|bigskip)\b", "\n\n", out)
    out = re.sub(r"\\noindent\b", "", out)
    out = re.sub(r"\\\\", "\n", out)
    out = re.sub(r"\\textbf\{([^{}]*)\}", r"**\1**", out)
    out = re.sub(r"\\emph\{([^{}]*)\}", r"*\1*", out)
    out = re.sub(r"\\begin\{center\}|\\end\{center\}", "\n", out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _render_text(
    text: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
) -> str:
    return _clean_latex_for_markdown(_materialize_visuals(text, hq, loaded, media_dir))


def _escape_table_cell(text: str) -> str:
    text = text.replace("|", r"\|")
    return "<br />".join(line.strip() for line in text.splitlines() if line.strip())


def _append_options(
    lines: list[str],
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
) -> None:
    q = hq.item
    if not q.options or not is_choice_type(q.type):
        return
    options = dict(sorted(q.options.items()))
    pairs = [(k, _render_text(v, hq, loaded, media_dir)) for k, v in choice_option_pairs(options)]
    layout = resolve_choice_layout(metadata, options)
    if layout == "inline_one_line":
        lines.append("    ".join(f"**{k}.** {v}" for k, v in pairs))
        lines.append("")
        return
    if layout == "grid_two_rows" and 2 <= len(pairs) <= 4:
        lines.extend(["|  |  |", "|---|---|"])
        for i in range(0, len(pairs), 2):
            left = pairs[i]
            right = pairs[i + 1] if i + 1 < len(pairs) else ("", "")
            left_cell = _escape_table_cell(f"**{left[0]}.** {left[1]}")
            right_cell = _escape_table_cell(f"**{right[0]}.** {right[1]}") if right[0] else ""
            lines.append(f"| {left_cell} | {right_cell} |")
        lines.append("")
        return
    for k, v in pairs:
        lines.append(f"- **{k}.** {v}")
    lines.append("")


def _append_teacher_solution(
    lines: list[str],
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    show_answers: bool,
) -> None:
    if not show_answers:
        return
    answer = _render_text(hq.item.answer, hq, loaded, media_dir)
    analysis = _render_text(hq.item.analysis or "", hq, loaded, media_dir)
    if answer:
        lines.append(f"**【答案】** {answer}")
        lines.append("")
    if analysis:
        lines.append(f"**【解析】** {analysis}")
        lines.append("")


def _append_question(
    lines: list[str],
    label: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    show_answers: bool,
) -> None:
    body = _render_text(hq.item.content, hq, loaded, media_dir)
    if body:
        lines.append(f"**{label}.** {body}")
    else:
        lines.append(f"**{label}.**")
    lines.append("")
    _append_options(lines, hq, loaded, media_dir, metadata)
    _append_teacher_solution(lines, hq, loaded, media_dir, show_answers=show_answers)


def _append_group_material(
    lines: list[str],
    label: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
) -> None:
    material = _render_text(hq.item.group_material or "", hq, loaded, media_dir)
    if not material:
        return
    lines.append(f"**{label}. 【材料】**")
    lines.append("")
    lines.append(material)
    lines.append("")


def _append_section_questions(
    lines: list[str],
    questions: list[HydratedQuestion],
    loaded: LoadedQuestions,
    media_dir: Path,
    metadata: dict[str, Any],
    *,
    show_answers: bool,
) -> None:
    global_n = 0
    i = 0
    n = len(questions)
    while i < n:
        hq = questions[i]
        q = hq.item
        if q.group_root_id is None:
            global_n += 1
            _append_question(
                lines,
                str(global_n),
                hq,
                loaded,
                media_dir,
                metadata,
                show_answers=show_answers,
            )
            i += 1
            continue

        j = i + 1
        while j < n and questions[j].qualified_id == hq.qualified_id:
            j += 1
        run = questions[i:j]
        if q.unified is False:
            global_n += 1
            major = global_n
            _append_group_material(lines, str(major), hq, loaded, media_dir)
            for idx, row in enumerate(run, start=1):
                _append_question(
                    lines,
                    f"{major}.{idx}",
                    row,
                    loaded,
                    media_dir,
                    metadata,
                    show_answers=show_answers,
                )
            i = j
            continue

        for idx, row in enumerate(run):
            global_n += 1
            if idx == 0:
                _append_group_material(lines, str(global_n), row, loaded, media_dir)
            _append_question(
                lines,
                str(global_n),
                row,
                loaded,
                media_dir,
                metadata,
                show_answers=show_answers,
            )
        i = j


def _render_docx_markdown(
    hydrated: HydratedExam,
    loaded: LoadedQuestions,
    media_dir: Path,
    *,
    show_answers: bool,
) -> str:
    meta = hydrated.metadata
    title = str(meta.get("title") or hydrated.exam_id).strip() or hydrated.exam_id
    lines: list[str] = [f"# {title}", ""]
    school = str(meta.get("school") or "").strip()
    subject = str(meta.get("subject") or "").strip()
    if school:
        lines.extend([school, ""])
    if subject:
        lines.extend([f"**科目：** {subject}", ""])
    if bool(meta.get("show_name_column")):
        lines.extend(["姓名：________    班级：________    学号：________", ""])
    notices = _clean_latex_for_markdown(str(meta.get("preamble_notices") or "").strip())
    if notices:
        lines.extend([notices, ""])

    for sec in hydrated.sections:
        lines.extend([f"## {sec.section_id}", ""])
        if sec.describe:
            lines.extend([_clean_latex_for_markdown(sec.describe), ""])
        _append_section_questions(
            lines,
            sec.questions,
            loaded,
            media_dir,
            meta,
            show_answers=show_answers,
        )
    return "\n".join(lines).rstrip() + "\n"


def _run_pandoc(md_path: Path, docx_path: Path, *, pandoc_path: str | None = None) -> None:
    pandoc = pandoc_path or resolve_exe("pandoc", "pandoc")
    if not pandoc:
        raise PandocError(
            "未检测到用于导出 Word 的文档转换组件 Pandoc。请在“设置/扩展组件”中安装或指定 Pandoc 后重试。"
        )
    docx_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        pandoc,
        md_path.name,
        "-f",
        "markdown+tex_math_dollars+pipe_tables+raw_tex",
        "-t",
        "docx",
        "--standalone",
        "--wrap=none",
        "-o",
        docx_path.name,
    ]
    try:
        proc = subprocess.run(
            cmd,
            cwd=md_path.parent,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            check=False,
        )
    except FileNotFoundError as e:
        raise PandocError(
            "未检测到用于导出 Word 的文档转换组件 Pandoc。请在“设置/扩展组件”中安装或指定 Pandoc 后重试。"
        ) from e
    except subprocess.TimeoutExpired as e:
        raise PandocError(
            "Pandoc 转换 Word 超时。",
            stdout=e.stdout or "",
            stderr=e.stderr or "",
        ) from e
    if proc.returncode != 0:
        raise PandocError(
            f"Pandoc 转换 Word 失败（退出码 {proc.returncode}）。",
            returncode=proc.returncode,
            stdout=proc.stdout or "",
            stderr=proc.stderr or "",
        )
    if not docx_path.is_file():
        raise PandocError("Pandoc reported success but DOCX not found.")


def _copy_docx_if_exists(work_dir: Path, stem: str, dest_dir: Path) -> Path:
    src = work_dir / f"{stem}.docx"
    if not src.is_file():
        raise PandocError(f"Pandoc output missing: {src.name}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dst = dest_dir / src.name
    shutil.copy2(src, dst)
    return dst


def build_exam_docx(
    exam_yaml: Path,
    out_dir: Path | None,
    *,
    clean_workdir: bool = False,
) -> tuple[Path, Path]:
    """Build student and teacher DOCX files with Pandoc."""
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
    validate_exam(exam, template, loaded)

    hydrated = hydrate(exam, template, loaded)
    work_dir = work_dir_for_exam(exam_yaml)
    if clean_workdir and work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    docx_work = work_dir / "docx"
    if docx_work.exists():
        shutil.rmtree(docx_work)
    docx_work.mkdir(parents=True, exist_ok=True)
    media_dir = docx_work / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    student_md = docx_work / "student_paper.md"
    teacher_md = docx_work / "teacher_paper.md"
    student_md.write_text(
        _render_docx_markdown(hydrated, loaded, media_dir, show_answers=False),
        encoding="utf-8",
    )
    teacher_md.write_text(
        _render_docx_markdown(hydrated, loaded, media_dir, show_answers=True),
        encoding="utf-8",
    )

    _run_pandoc(student_md, docx_work / "student_paper.docx")
    _run_pandoc(teacher_md, docx_work / "teacher_paper.docx")

    dest = out_dir if out_dir is not None else exam_parent_dir(exam_yaml)
    dest = dest.resolve()
    student_out = _copy_docx_if_exists(docx_work, "student_paper", dest)
    teacher_out = _copy_docx_if_exists(docx_work, "teacher_paper", dest)
    return student_out, teacher_out
