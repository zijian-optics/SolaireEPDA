from __future__ import annotations

from solaire.exam_compiler.pipeline.table_expand import (
    expand_tables_for_docx_markdown,
    expand_tables_for_latex,
    table_to_latex,
    table_to_openxml,
)


TABLE = """version: 1
rows:
  - - text: 项目
      header: true
      rowSpan: 2
    - text: 数值
      header: true
      colSpan: 2
  - - text: $x$
    - text: 说明
"""


EMPTY_TABLE = """version: 1
rows:
  - - text: ''
    - text: ''
    - text: ''
  - - text: ''
    - text: ''
    - text: ''
  - - text: ''
    - text: ''
    - text: ''
"""


def test_table_to_latex_supports_colspan_and_rowspan() -> None:
    out = table_to_latex(TABLE)

    assert "\\begin{tabular}" in out
    assert "\\providecommand{\\multirow}[3]{#3}" in out
    assert "\\multicolumn{2}" in out
    assert "\\multirow{2}" in out
    assert "$x$" in out


def test_empty_table_to_latex_does_not_require_array_package() -> None:
    out = table_to_latex(EMPTY_TABLE)

    assert "\\begin{tabular}" in out
    assert "\\arraybackslash" not in out
    assert ">{" not in out
    assert "\\multirow" not in out
    assert " &  & " in out


def test_expand_tables_for_latex_replaces_fenced_block() -> None:
    out = expand_tables_for_latex(f"before\n```solaire-table\n{TABLE}```\nafter")

    assert "```solaire-table" not in out
    assert "\\begin{tabular}" in out
    assert "before" in out
    assert "after" in out


def test_table_to_openxml_supports_word_merges() -> None:
    out = table_to_openxml(TABLE)

    assert "<w:tbl" in out
    assert '<w:gridSpan w:val="2"/>' in out
    assert '<w:vMerge w:val="restart"/>' in out
    assert "<w:vMerge/>" in out
    assert "<m:oMath>" in out


def test_expand_tables_for_docx_markdown_emits_raw_openxml() -> None:
    out = expand_tables_for_docx_markdown(f"before\n```solaire-table\n{TABLE}```\nafter")

    assert "```{=openxml}" in out
    assert "<w:tbl" in out
    assert "```solaire-table" not in out
