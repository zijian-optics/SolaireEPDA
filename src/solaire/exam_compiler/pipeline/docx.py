"""Pandoc-backed DOCX export pipeline."""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

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
_COMMON_MATH_MACROS_RE = re.compile(r"\\(arccot|dlim|dint|e|i)(?![A-Za-z])")
_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_XML_NAMESPACES = {
    "w": _W_NS,
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
}

for _prefix, _uri in _XML_NAMESPACES.items():
    ET.register_namespace(_prefix, _uri)


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


def _expand_common_math_macros(math: str) -> str:
    replacements = {
        "arccot": r"\operatorname{arccot}",
        "dlim": r"\displaystyle\lim",
        "dint": r"\displaystyle\int",
        "e": r"\mathrm{e}",
        "i": r"\mathrm{i}",
    }
    return _COMMON_MATH_MACROS_RE.sub(lambda m: replacements[m.group(1)], math)


def _normalize_docx_math_macros(text: str) -> str:
    if "$" not in text:
        return text
    parts: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "$" or (i > 0 and text[i - 1] == "\\"):
            parts.append(text[i])
            i += 1
            continue
        delim = "$$" if i + 1 < n and text[i + 1] == "$" else "$"
        start = i + len(delim)
        end = start
        while True:
            end = text.find(delim, end)
            if end == -1:
                parts.append(text[i:])
                return "".join(parts)
            if end == 0 or text[end - 1] != "\\":
                break
            end += len(delim)
        parts.append(delim)
        parts.append(_expand_common_math_macros(text[start:end]))
        parts.append(delim)
        i = end + len(delim)
    return "".join(parts)


def _render_text(
    text: str,
    hq: HydratedQuestion,
    loaded: LoadedQuestions,
    media_dir: Path,
) -> str:
    return _normalize_docx_math_macros(
        _clean_latex_for_markdown(_materialize_visuals(text, hq, loaded, media_dir))
    )


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


def _w(name: str) -> str:
    return f"{{{_W_NS}}}{name}"


def _decode_process_output(data: bytes | str | None) -> str:
    if data is None:
        return ""
    if isinstance(data, bytes):
        return data.decode("utf-8", errors="replace")
    return data


def _ensure_child(parent: ET.Element, name: str) -> ET.Element:
    child = parent.find(_w(name))
    if child is None:
        child = ET.SubElement(parent, _w(name))
    return child


def _remove_children(parent: ET.Element, name: str) -> None:
    tag = _w(name)
    for child in list(parent):
        if child.tag == tag:
            parent.remove(child)


def _set_val(parent: ET.Element, name: str, value: str) -> ET.Element:
    child = _ensure_child(parent, name)
    child.set(_w("val"), value)
    return child


def _set_on_off(parent: ET.Element, name: str, enabled: bool) -> None:
    if enabled:
        child = _ensure_child(parent, name)
        child.attrib.pop(_w("val"), None)
    else:
        _remove_children(parent, name)


def _style_by_id(styles_root: ET.Element, style_id: str) -> ET.Element | None:
    for style in styles_root.findall(_w("style")):
        if style.get(_w("styleId")) == style_id:
            return style
    return None


def _find_or_create_style(
    styles_root: ET.Element,
    style_ids: tuple[str, ...],
    *,
    style_type: str,
    display_name: str,
) -> ET.Element:
    for style_id in style_ids:
        style = _style_by_id(styles_root, style_id)
        if style is not None:
            return style
    style = ET.SubElement(
        styles_root,
        _w("style"),
        {_w("type"): style_type, _w("styleId"): style_ids[0]},
    )
    _set_val(style, "name", display_name)
    return style


def _set_run_properties(
    rpr: ET.Element,
    *,
    east_asia_font: str,
    latin_font: str = "Times New Roman",
    size_half_points: int,
    bold: bool = False,
) -> None:
    fonts = _ensure_child(rpr, "rFonts")
    fonts.set(_w("ascii"), latin_font)
    fonts.set(_w("hAnsi"), latin_font)
    fonts.set(_w("eastAsia"), east_asia_font)
    fonts.set(_w("cs"), latin_font)
    _set_val(rpr, "sz", str(size_half_points))
    _set_val(rpr, "szCs", str(size_half_points))
    _set_val(rpr, "color", "000000")
    lang = _ensure_child(rpr, "lang")
    lang.set(_w("val"), "en-US")
    lang.set(_w("eastAsia"), "zh-CN")
    _set_on_off(rpr, "b", bold)
    _set_on_off(rpr, "bCs", bold)


def _set_paragraph_properties(
    ppr: ET.Element,
    *,
    before_twips: int,
    after_twips: int,
    line_twips: int,
    alignment: str | None = None,
    keep_next: bool = False,
) -> None:
    spacing = _ensure_child(ppr, "spacing")
    spacing.set(_w("before"), str(before_twips))
    spacing.set(_w("after"), str(after_twips))
    spacing.set(_w("line"), str(line_twips))
    spacing.set(_w("lineRule"), "exact")
    if alignment:
        _set_val(ppr, "jc", alignment)
    else:
        _remove_children(ppr, "jc")
    _set_on_off(ppr, "keepNext", keep_next)


def _patch_paragraph_style(
    styles_root: ET.Element,
    style_ids: tuple[str, ...],
    *,
    display_name: str,
    east_asia_font: str,
    size_half_points: int,
    bold: bool,
    before_twips: int,
    after_twips: int,
    line_twips: int,
    alignment: str | None = None,
    keep_next: bool = False,
) -> None:
    style = _find_or_create_style(
        styles_root,
        style_ids,
        style_type="paragraph",
        display_name=display_name,
    )
    ppr = _ensure_child(style, "pPr")
    rpr = _ensure_child(style, "rPr")
    _set_paragraph_properties(
        ppr,
        before_twips=before_twips,
        after_twips=after_twips,
        line_twips=line_twips,
        alignment=alignment,
        keep_next=keep_next,
    )
    _set_run_properties(
        rpr,
        east_asia_font=east_asia_font,
        size_half_points=size_half_points,
        bold=bold,
    )


def _patch_table_style(styles_root: ET.Element) -> None:
    style = _find_or_create_style(
        styles_root,
        ("Table", "TableGrid"),
        style_type="table",
        display_name="Table",
    )
    rpr = _ensure_child(style, "rPr")
    _set_run_properties(rpr, east_asia_font="SimSun", size_half_points=21)
    tbl_pr = _ensure_child(style, "tblPr")
    cell_mar = _ensure_child(tbl_pr, "tblCellMar")
    for side in ("top", "left", "bottom", "right"):
        cell = _ensure_child(cell_mar, side)
        cell.set(_w("w"), "90")
        cell.set(_w("type"), "dxa")


def _patch_reference_styles_xml(styles_xml: bytes) -> bytes:
    root = ET.fromstring(styles_xml)
    defaults = _ensure_child(root, "docDefaults")
    default_rpr = _ensure_child(_ensure_child(defaults, "rPrDefault"), "rPr")
    default_ppr = _ensure_child(_ensure_child(defaults, "pPrDefault"), "pPr")
    _set_run_properties(default_rpr, east_asia_font="SimSun", size_half_points=21)
    _set_paragraph_properties(
        default_ppr,
        before_twips=0,
        after_twips=60,
        line_twips=360,
    )

    body_styles = (
        ("Normal",),
        ("BodyText",),
        ("FirstParagraph",),
        ("Compact",),
        ("BlockText",),
    )
    for style_ids in body_styles:
        _patch_paragraph_style(
            root,
            style_ids,
            display_name=style_ids[0],
            east_asia_font="SimSun",
            size_half_points=21,
            bold=False,
            before_twips=0,
            after_twips=60,
            line_twips=360,
        )

    _patch_paragraph_style(
        root,
        ("Title",),
        display_name="Title",
        east_asia_font="SimHei",
        size_half_points=36,
        bold=True,
        before_twips=0,
        after_twips=240,
        line_twips=440,
        alignment="center",
        keep_next=True,
    )
    _patch_paragraph_style(
        root,
        ("Heading1",),
        display_name="Heading 1",
        east_asia_font="SimHei",
        size_half_points=36,
        bold=True,
        before_twips=0,
        after_twips=240,
        line_twips=440,
        alignment="center",
        keep_next=True,
    )
    _patch_paragraph_style(
        root,
        ("Heading2",),
        display_name="Heading 2",
        east_asia_font="SimHei",
        size_half_points=24,
        bold=True,
        before_twips=160,
        after_twips=80,
        line_twips=360,
        keep_next=True,
    )
    _patch_paragraph_style(
        root,
        ("Heading3",),
        display_name="Heading 3",
        east_asia_font="SimHei",
        size_half_points=22,
        bold=True,
        before_twips=120,
        after_twips=60,
        line_twips=340,
        keep_next=True,
    )
    _patch_paragraph_style(
        root,
        ("Caption",),
        display_name="Caption",
        east_asia_font="SimSun",
        size_half_points=18,
        bold=False,
        before_twips=40,
        after_twips=60,
        line_twips=300,
        alignment="center",
    )
    _patch_table_style(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _patch_reference_document_xml(document_xml: bytes) -> bytes:
    root = ET.fromstring(document_xml)
    body = root.find(_w("body"))
    if body is None:
        return document_xml
    sect_pr = body.find(_w("sectPr"))
    if sect_pr is None:
        sect_pr = ET.SubElement(body, _w("sectPr"))
    pg_sz = _ensure_child(sect_pr, "pgSz")
    pg_sz.set(_w("w"), "11906")
    pg_sz.set(_w("h"), "16838")
    pg_mar = _ensure_child(sect_pr, "pgMar")
    pg_mar.set(_w("top"), "1134")
    pg_mar.set(_w("bottom"), "1134")
    pg_mar.set(_w("left"), "1021")
    pg_mar.set(_w("right"), "1021")
    pg_mar.set(_w("header"), "567")
    pg_mar.set(_w("footer"), "567")
    pg_mar.set(_w("gutter"), "0")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _patch_reference_docx(reference_docx: Path) -> None:
    tmp = reference_docx.with_name(f"{reference_docx.stem}.tmp.docx")
    with zipfile.ZipFile(reference_docx, "r") as zin:
        names = set(zin.namelist())
        replacements: dict[str, bytes] = {}
        if "word/styles.xml" in names:
            replacements["word/styles.xml"] = _patch_reference_styles_xml(
                zin.read("word/styles.xml")
            )
        if "word/document.xml" in names:
            replacements["word/document.xml"] = _patch_reference_document_xml(
                zin.read("word/document.xml")
            )
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = replacements.get(item.filename)
                if data is None:
                    data = zin.read(item.filename)
                zout.writestr(item, data)
    tmp.replace(reference_docx)


def _ensure_gaokao_reference_docx(reference_docx: Path, pandoc: str) -> Path:
    if reference_docx.is_file() and reference_docx.stat().st_size > 0:
        return reference_docx
    reference_docx.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.run(
            [pandoc, "--print-default-data-file=reference.docx"],
            capture_output=True,
            timeout=60,
            check=False,
        )
    except FileNotFoundError as e:
        raise PandocError(
            "未检测到用于导出 Word 的文档转换组件 Pandoc。请在“设置/扩展组件”中安装或指定 Pandoc 后重试。"
        ) from e
    except subprocess.TimeoutExpired as e:
        raise PandocError(
            "Pandoc 生成 Word 样式模板超时。",
            stdout=_decode_process_output(e.stdout),
            stderr=_decode_process_output(e.stderr),
        ) from e
    if proc.returncode != 0 or not proc.stdout:
        raise PandocError(
            "Pandoc 生成 Word 样式模板失败。",
            returncode=proc.returncode,
            stdout=_decode_process_output(proc.stdout),
            stderr=_decode_process_output(proc.stderr),
        )
    reference_docx.write_bytes(proc.stdout)
    try:
        _patch_reference_docx(reference_docx)
    except (OSError, zipfile.BadZipFile, ET.ParseError) as e:
        raise PandocError(f"无法准备 Word 样式模板: {e}") from e
    return reference_docx

def _run_pandoc(
    md_path: Path,
    docx_path: Path,
    *,
    pandoc_path: str | None = None,
    reference_docx: Path | None = None,
) -> None:
    pandoc = pandoc_path or resolve_exe("pandoc", "pandoc")
    if not pandoc:
        raise PandocError(
            "未检测到用于导出 Word 的文档转换组件 Pandoc。请在“设置/扩展组件”中安装或指定 Pandoc 后重试。"
        )
    docx_path.parent.mkdir(parents=True, exist_ok=True)
    reference = reference_docx or _ensure_gaokao_reference_docx(
        md_path.parent / "gaokao_reference.docx",
        pandoc,
    )
    cmd = [
        pandoc,
        md_path.name,
        "-f",
        "markdown+tex_math_dollars+pipe_tables+raw_tex",
        "-t",
        "docx",
        "--standalone",
        "--wrap=none",
        "--reference-doc",
        str(reference.resolve()),
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
