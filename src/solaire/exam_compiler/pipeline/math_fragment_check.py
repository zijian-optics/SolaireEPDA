"""Static checks on math delimiters and LaTeX plain-text hazards."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from solaire.exam_compiler.loaders.questions import LoadedQuestions

from solaire.exam_compiler.models import BankRecord, QuestionGroupRecord, QuestionItem

# Scanner modes: normal text, inline math, display math.
_OUT, _IN, _DISP = "out", "in", "disp"


def _collect_text_fields(rec: BankRecord) -> list[tuple[str, str]]:
    """Return (field_label, text) pairs that should be checked."""
    if isinstance(rec, QuestionItem):
        parts: list[tuple[str, str]] = [
            ("content", rec.content),
            ("answer", rec.answer),
            ("analysis", rec.analysis),
        ]
        if rec.options:
            for k, v in rec.options.items():
                parts.append((f"option_{k}", v))
        return [(a, b) for a, b in parts if (b or "").strip()]
    if isinstance(rec, QuestionGroupRecord):
        out: list[tuple[str, str]] = [("material", rec.material)]
        for qi in rec.flatten():
            out.append(("content", qi.content))
            out.append(("answer", qi.answer))
            out.append(("analysis", qi.analysis))
            if qi.options:
                for k, v in qi.options.items():
                    out.append((f"option_{k}", v))
        return [(a, b) for a, b in out if (b or "").strip()]
    return []


def _unescaped_dollar_count(seg: str) -> int:
    n = 0
    i = 0
    while i < len(seg):
        if seg[i] == "\\" and i + 1 < len(seg):
            i += 2
            continue
        if seg[i] == "$":
            n += 1
        i += 1
    return n


def _check_dollar_balance(text: str) -> list[str]:
    """Detect unbalanced $ / $$ delimiters, ignoring escaped \\$ text."""
    warnings: list[str] = []
    if "$$" in text and text.count("$$") % 2 != 0:
        warnings.append("\u0060$$\u0060 \u51fa\u73b0\u6b21\u6570\u4e3a\u5947\u6570\uff0c\u53ef\u80fd\u5b58\u5728\u672a\u95ed\u5408\u7684\u663e\u793a\u516c\u5f0f\u3002")
    parts = text.split("$$")
    for i in range(0, len(parts), 2):
        seg = parts[i]
        if _unescaped_dollar_count(seg) % 2 != 0:
            warnings.append("\u5728\u663e\u793a\u516c\u5f0f\u5757\u4e4b\u5916\uff0c\u5355\u4e2a \u0060$\u0060 \u672a\u6210\u5bf9\uff0c\u8bf7\u68c0\u67e5\u884c\u5185\u516c\u5f0f\u3002")
            break
    return warnings


def _check_latex_special_chars_outside_math(text: str) -> list[tuple[str, str]]:
    """
    In LaTeX, unescaped `_`, `^`, and `%` outside math mode often break export.

    Return one warning per code for text outside `$...$` and `$$...$$`; escaped
    characters are ignored.
    """
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    mode = _OUT
    i = 0
    n = len(text)

    while i < n:
        if text[i] == "\\" and i + 1 < n:
            i += 2
            continue

        if mode == _OUT:
            if i + 1 < n and text[i : i + 2] == "$$":
                mode = _DISP
                i += 2
                continue
            if text[i] == "$":
                mode = _IN
                i += 1
                continue
            if text[i] == "_" and "latex_underscore" not in seen:
                out.append(
                    (
                        "latex_underscore",
                        "\u6b63\u6587\uff08\u975e\u6570\u5b66\u6a21\u5f0f\uff09\u4e2d\u51fa\u73b0\u672a\u8f6c\u4e49\u7684\u4e0b\u5212\u7ebf \u0060_\u0060\uff0cLaTeX \u5bfc\u51fa\u53ef\u80fd\u62a5\u9519\uff1b"
                        "\u586b\u7a7a\u6a2a\u7ebf\u8bf7\u4f7f\u7528 \u0060\\\\_\u0060 \u8fde\u7eed\u4e66\u5199\u6216 \u0060\\\\underline{...}\u0060\u3002",
                    )
                )
                seen.add("latex_underscore")
            elif text[i] == "^" and "latex_caret" not in seen:
                out.append(
                    (
                        "latex_caret",
                        "\u6b63\u6587\uff08\u975e\u6570\u5b66\u6a21\u5f0f\uff09\u4e2d\u51fa\u73b0\u672a\u8f6c\u4e49\u7684 \u0060^\u0060\uff0cLaTeX \u5bfc\u51fa\u53ef\u80fd\u62a5\u9519\uff1b"
                        "\u8bf7\u4f7f\u7528 \u0060\\\\^{}\u0060 \u6216\u653e\u5165\u6570\u5b66\u516c\u5f0f\u4e2d\u3002",
                    )
                )
                seen.add("latex_caret")
            elif text[i] == "%" and "latex_percent" not in seen:
                out.append(
                    (
                        "latex_percent",
                        "\u6b63\u6587\uff08\u975e\u6570\u5b66\u6a21\u5f0f\uff09\u4e2d\u51fa\u73b0\u672a\u8f6c\u4e49\u7684 \u0060%\u0060\uff0cLaTeX \u4f1a\u5c06\u5176\u89c6\u4e3a\u6ce8\u91ca\u8d77\u59cb\uff1b"
                        "\u8bf7\u6539\u4e3a \u0060\\\\%\u0060\u3002",
                    )
                )
                seen.add("latex_percent")
            i += 1
            continue

        if mode == _IN:
            if text[i] == "$":
                mode = _OUT
                i += 1
                continue
            i += 1
            continue

        # _DISP
        if i + 1 < n and text[i : i + 2] == "$$":
            mode = _OUT
            i += 2
            continue
        i += 1

    return out


def analyze_math_static_for_record(qualified_id: str, rec: BankRecord) -> list[dict[str, str]]:
    """Return static format warnings for one question-bank record."""
    results: list[dict[str, str]] = []
    for field, text in _collect_text_fields(rec):
        for code, msg in _check_latex_special_chars_outside_math(text):
            results.append(
                {
                    "qualified_id": qualified_id,
                    "field": field,
                    "code": code,
                    "message": msg,
                }
            )
        if "$" not in text and "$$" not in text:
            continue
        for msg in _check_dollar_balance(text):
            results.append(
                {
                    "qualified_id": qualified_id,
                    "field": field,
                    "code": "math_delimiter",
                    "message": msg,
                }
            )
    return results


def analyze_math_static_for_loaded(loaded: LoadedQuestions) -> list[dict[str, str]]:
    """
    Return warning dicts for all loaded questions.

    Codes:
    - math_delimiter: `$` / `$$` delimiters look unbalanced
    - latex_underscore / latex_caret / latex_percent: unescaped TeX special
      characters appear outside math mode
    """
    results: list[dict[str, str]] = []
    for qid, rec in loaded.by_qualified.items():
        results.extend(analyze_math_static_for_record(qid, rec))
    return results
