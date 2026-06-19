"""Locate and load template.yaml."""

from __future__ import annotations

from pathlib import Path

import yaml

from solaire.exam_compiler.merge_util import deep_merge
from solaire.exam_compiler.models import ExamConfig, ExamTemplate
from solaire.exam_compiler.latex_jinja_paths import latex_jinja_loader_dirs


def _normalize_remediation_practice_template(data: dict) -> None:
    if data.get("template_id") != "remediation_practice":
        return
    sections = data.get("sections")
    if isinstance(sections, list):
        for sec in sections:
            if not isinstance(sec, dict):
                continue
            if sec.get("type") == "practice":
                sec.pop("describe", None)
                if sec.get("score_per_item") in (None, 0, 0.0):
                    sec["score_per_item"] = 5
    md = data.setdefault("metadata_defaults", {})
    if isinstance(md, dict):
        md.update(
            {
                "show_binding_line": False,
                "show_name_column": False,
                "show_page_number_footer": False,
                "show_student_sidebar": False,
                "preamble_notices": "",
                "title_block_style": "default",
                "section_heading_style": "section_star",
                "include_common_math_macros": True,
            }
        )


def resolve_template_yaml_path(exam_yaml: Path, exam: ExamConfig) -> Path:
    exam_dir = exam_yaml.resolve().parent
    if exam.template_path:
        p = (exam_dir / exam.template_path).resolve()
        if p.is_file():
            return p
        raise FileNotFoundError(f"template_path not found: {p}")

    cand = exam_dir / "templates" / exam.template_ref / "template.yaml"
    if cand.is_file():
        return cand.resolve()

    cand2 = exam_dir / "template.yaml"
    if cand2.is_file():
        return cand2.resolve()

    raise FileNotFoundError(
        f"Could not find template for template_ref={exam.template_ref!r}. "
        f"Set template_path in exam.yaml or place template at {cand} or {cand2}"
    )


def load_template(path: Path) -> ExamTemplate:
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        data = {}
    defaults_path = path.parent / "defaults.yaml"
    if defaults_path.is_file():
        with defaults_path.open(encoding="utf-8") as f:
            pkg = yaml.safe_load(f) or {}
        if isinstance(pkg, dict):
            inner = pkg.get("metadata_defaults")
            base = inner if isinstance(inner, dict) else pkg
            data["metadata_defaults"] = deep_merge(dict(base), dict(data.get("metadata_defaults") or {}))
    _normalize_remediation_practice_template(data)
    t = ExamTemplate.model_validate(data)
    latex_jinja_loader_dirs(path.parent, t.latex_base)
    return t
