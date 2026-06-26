"""Expand ```solaire-table``` fenced blocks for preview/export pipelines."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

import yaml

from solaire.exam_compiler.latex_util import latex_escape_text

TABLE_FENCE_RE = re.compile(r"```solaire-table\s*\n(.*?)```", re.DOTALL)

Align = Literal["left", "center", "right"]


@dataclass(frozen=True)
class TableCell:
    text: str = ""
    header: bool = False
    align: Align | None = None
    row_span: int = 1
    col_span: int = 1


@dataclass(frozen=True)
class TableAnchor:
    row: int
    col: int
    cell: TableCell


@dataclass(frozen=True)
class TableSlot:
    anchor_row: int
    anchor_col: int
    cell: TableCell
    covered: bool


@dataclass(frozen=True)
class ExpandedTable:
    width: int
    height: int
    slots: list[list[TableSlot]]
    anchors: list[TableAnchor]


def _span(raw: Any, key: str) -> int:
    if raw is None:
        return 1
    if not isinstance(raw, int) or raw < 1:
        raise ValueError(f"{key} must be a positive integer")
    return raw


def _cell(raw: Any) -> TableCell:
    if isinstance(raw, (str, int, float, bool)):
        return TableCell(text=str(raw))
    if not isinstance(raw, dict):
        raise ValueError("table cell must be an object")
    align = raw.get("align")
    if align is not None:
        align = str(align)
        if align not in {"left", "center", "right"}:
            raise ValueError("table cell align must be left, center, or right")
    return TableCell(
        text="" if raw.get("text") is None else str(raw.get("text")),
        header=raw.get("header") is True,
        align=align,  # type: ignore[arg-type]
        row_span=_span(raw.get("rowSpan", raw.get("rowspan")), "rowSpan"),
        col_span=_span(raw.get("colSpan", raw.get("colspan")), "colSpan"),
    )


def parse_table(source: str) -> list[list[TableCell]]:
    raw = yaml.safe_load(source)
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise ValueError("unsupported solaire-table version")
    rows = raw.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("table rows must be a non-empty array")
    out: list[list[TableCell]] = []
    for row in rows:
        if not isinstance(row, list):
            raise ValueError("each table row must be an array")
        out.append([_cell(c) for c in row])
    expand_table(out)
    return out


def expand_table(rows: list[list[TableCell]]) -> ExpandedTable:
    slots: list[list[TableSlot | None]] = [[] for _ in rows]
    anchors: list[TableAnchor] = []
    for r, row in enumerate(rows):
        c = 0
        for cell in row:
            if r + cell.row_span > len(rows):
                raise ValueError("rowSpan exceeds table height")
            while c < len(slots[r]) and slots[r][c] is not None:
                c += 1
            for rr in range(r, r + cell.row_span):
                while len(slots[rr]) < c + cell.col_span:
                    slots[rr].append(None)
                for cc in range(c, c + cell.col_span):
                    if slots[rr][cc] is not None:
                        raise ValueError("table cells overlap")
            anchors.append(TableAnchor(row=r, col=c, cell=cell))
            for rr in range(r, r + cell.row_span):
                for cc in range(c, c + cell.col_span):
                    slots[rr][cc] = TableSlot(
                        anchor_row=r,
                        anchor_col=c,
                        cell=cell,
                        covered=rr != r or cc != c,
                    )
            c += cell.col_span
    width = max(len(row) for row in slots)
    dense: list[list[TableSlot]] = []
    for row in slots:
        if len(row) != width or any(slot is None for slot in row):
            raise ValueError("table must be rectangular")
        dense.append([slot for slot in row if slot is not None])
    return ExpandedTable(width=width, height=len(rows), slots=dense, anchors=anchors)


def _latex_text(text: str) -> str:
    if not text:
        return ""
    out: list[str] = []
    i = 0
    while i < len(text):
        if text[i] == "$":
            delim = "$$" if text.startswith("$$", i) else "$"
            end = text.find(delim, i + len(delim))
            if end != -1:
                out.append(text[i : end + len(delim)])
                i = end + len(delim)
                continue
        j = text.find("$", i)
        chunk = text[i:] if j == -1 else text[i:j]
        out.append(latex_escape_text(chunk).replace("\n", r"\newline "))
        if j == -1:
            break
        i = j
    return "".join(out)


def _col_width(width: int, span: int = 1) -> str:
    portion = max(0.12, min(0.92, 0.92 * span / max(width, 1)))
    return f"{portion:.3f}\\linewidth"


def table_to_latex(source: str) -> str:
    expanded = expand_table(parse_table(source))
    spec = "|" + "|".join([rf">{{\raggedright\arraybackslash}}p{{{_col_width(expanded.width)}}}" for _ in range(expanded.width)]) + "|"
    lines = [r"\begin{center}", r"\small", rf"\begin{{tabular}}{{{spec}}}", r"\hline"]
    for r, row in enumerate(expanded.slots):
        rendered: list[str] = []
        c = 0
        while c < expanded.width:
            slot = row[c]
            cell = slot.cell
            if slot.covered:
                if slot.anchor_row < r and slot.anchor_col == c:
                    if cell.col_span > 1:
                        rendered.append(rf"\multicolumn{{{cell.col_span}}}{{|p{{{_col_width(expanded.width, cell.col_span)}}}|}}{{}}")
                    else:
                        rendered.append("")
                    c += cell.col_span
                    continue
                c += 1
                continue
            body = _latex_text(cell.text)
            if cell.header:
                body = rf"\textbf{{{body}}}"
            if cell.row_span > 1:
                body = rf"\multirow{{{cell.row_span}}}{{*}}{{{body}}}"
            if cell.col_span > 1:
                body = rf"\multicolumn{{{cell.col_span}}}{{|p{{{_col_width(expanded.width, cell.col_span)}}}|}}{{{body}}}"
            rendered.append(body)
            c += cell.col_span
        lines.append(" & ".join(rendered) + r" \\")
        lines.append(r"\hline")
    lines.extend([r"\end{tabular}", r"\end{center}"])
    return "\n".join(lines)


def expand_tables_for_latex(text: str) -> str:
    if not text or "```solaire-table" not in text:
        return text
    return TABLE_FENCE_RE.sub(lambda m: "\n" + table_to_latex(m.group(1)) + "\n", text)


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _paragraph_content_with_math(text: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(text):
        if text[i] == "$":
            delim = "$$" if text.startswith("$$", i) else "$"
            end = text.find(delim, i + len(delim))
            if end != -1:
                math = _xml_escape(text[i + len(delim) : end])
                out.append(f"<m:oMath><m:r><m:t>{math}</m:t></m:r></m:oMath>")
                i = end + len(delim)
                continue
        j = text.find("$", i)
        chunk = text[i:] if j == -1 else text[i:j]
        if chunk:
            out.append(f'<w:r><w:t xml:space="preserve">{_xml_escape(chunk)}</w:t></w:r>')
        if j == -1:
            break
        i = j
    return "".join(out) or '<w:r><w:t xml:space="preserve"></w:t></w:r>'


def _cell_paragraphs(text: str) -> str:
    lines = text.splitlines() or [""]
    return "".join("<w:p>" + _paragraph_content_with_math(line) + "</w:p>" for line in lines)


def table_to_openxml(source: str) -> str:
    expanded = expand_table(parse_table(source))
    grid = "".join('<w:gridCol w:w="2400"/>' for _ in range(expanded.width))
    rows: list[str] = []
    for r, row in enumerate(expanded.slots):
        cells: list[str] = []
        c = 0
        while c < expanded.width:
            slot = row[c]
            cell = slot.cell
            if slot.covered:
                if slot.anchor_row < r and slot.anchor_col == c:
                    props = []
                    if cell.col_span > 1:
                        props.append(f'<w:gridSpan w:val="{cell.col_span}"/>')
                    props.append("<w:vMerge/>")
                    cells.append(f"<w:tc><w:tcPr>{''.join(props)}</w:tcPr><w:p/></w:tc>")
                    c += cell.col_span
                    continue
                c += 1
                continue
            props = ['<w:tcW w:w="2400" w:type="dxa"/>']
            if cell.col_span > 1:
                props.append(f'<w:gridSpan w:val="{cell.col_span}"/>')
            if cell.row_span > 1:
                props.append('<w:vMerge w:val="restart"/>')
            if cell.header:
                props.append('<w:shd w:fill="F1F5F9"/>')
            cells.append(f"<w:tc><w:tcPr>{''.join(props)}</w:tcPr>{_cell_paragraphs(cell.text)}</w:tc>")
            c += cell.col_span
        rows.append("<w:tr>" + "".join(cells) + "</w:tr>")
    return (
        '<w:tbl xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
        '<w:tblPr><w:tblBorders>'
        '<w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/>'
        "</w:tblBorders></w:tblPr>"
        f"<w:tblGrid>{grid}</w:tblGrid>"
        + "".join(rows)
        + "</w:tbl>"
    )


def expand_tables_for_docx_markdown(text: str) -> str:
    if not text or "```solaire-table" not in text:
        return text

    def repl(match: re.Match[str]) -> str:
        return "\n\n```{=openxml}\n" + table_to_openxml(match.group(1)) + "\n```\n\n"

    return TABLE_FENCE_RE.sub(repl, text)
