"""Create editable remediation exam workspaces from score diagnosis results."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from solaire.edu_analysis.diagnosis import teaching_suggestions_v1
from solaire.exam_compiler.facade import QuestionGroupRecord, QuestionItem, load_all_questions
from solaire.web.exam_service import ensure_probe_list_yaml
from solaire.web.exam_workspace_service import (
    load_exam_workspace,
    persist_exam_document,
    save_exam_workspace,
)

PRACTICE_TEMPLATE_ID = "remediation_practice"
PRACTICE_TEMPLATE_PATH = ".solaire/internal_templates/remediation_practice.yaml"
PRACTICE_SECTION_ID = "练习题"
LOW_COUNT_THRESHOLD = 3


def _norm_text(s: object) -> str:
    return " ".join(str(s or "").strip().split())


def _source_subject(source_doc: dict[str, Any], exam_id: str) -> str:
    subject = _norm_text(source_doc.get("subject"))
    if subject:
        return subject
    metadata = source_doc.get("metadata")
    if isinstance(metadata, dict):
        subject = _norm_text(metadata.get("subject"))
        if subject:
            return subject
    parts = exam_id.replace("\\", "/").split("/")
    return _norm_text(parts[-1] if parts else "") or "科目"


def _source_export_label(source_doc: dict[str, Any], exam_id: str) -> str:
    label = _norm_text(source_doc.get("export_label"))
    if label:
        return label
    metadata = source_doc.get("metadata")
    if isinstance(metadata, dict):
        label = _norm_text(metadata.get("export_label") or metadata.get("title"))
        if label:
            return label
    parts = exam_id.replace("\\", "/").split("/")
    return _norm_text(parts[0] if parts else exam_id) or "考试"


def _source_question_ids(source_doc: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for sec in source_doc.get("selected_items") or []:
        if not isinstance(sec, dict):
            continue
        for qid in sec.get("question_ids") or []:
            out.add(str(qid))
    return out


def _question_kind(record: object) -> str | None:
    if isinstance(record, QuestionItem):
        return str(record.type)
    if isinstance(record, QuestionGroupRecord):
        return "group"
    return None


def _section_accepts(section_type: str, question_type: str | None) -> bool:
    if not question_type:
        return False
    if section_type == "text":
        return False
    if section_type == "choice":
        return question_type in {"choice", "single_choice", "multiple_choice"}
    if section_type == "group":
        return question_type == "group"
    return section_type == question_type


def _load_project_questions(project_root: Path):
    probe = ensure_probe_list_yaml(project_root)
    question_libraries = []

    with probe.open(encoding="utf-8") as f:
        raw_probe = yaml.safe_load(f) or {}
    for lib in raw_probe.get("question_libraries") or []:
        if isinstance(lib, dict):
            question_libraries.append((str(lib.get("namespace") or ""), str(lib.get("path") or "")))
    return load_all_questions(probe, question_libraries)


def _build_ai_assist_prompt(payload: dict[str, Any]) -> str:
    exam_id = payload.get("exam_id") or ""
    batch_id = payload.get("batch_id") or ""
    selected_count = int(payload.get("selected_count") or 0)
    missing_count = max(0, LOW_COUNT_THRESHOLD - selected_count)
    lines = [
        "请协助为这次学情诊断补充练习题草稿。",
        "",
        f"原考试：{exam_id}",
        f"成绩批次：{batch_id}",
        f"当前题库可直接生成的题量：{selected_count} 道",
        f"建议至少再补充：{missing_count} 道",
        "",
        "薄弱知识点与已有可用题：",
    ]
    for node in payload.get("nodes") or []:
        name = node.get("canonical_name") or node.get("node_id") or "未命名知识点"
        qids = node.get("selected_question_ids") or []
        excluded = node.get("excluded_source_question_ids") or []
        lines.append(f"- {name}")
        lines.append(f"  - 当前可用题：{', '.join(qids) if qids else '无'}")
        if excluded:
            lines.append(f"  - 已排除原卷题：{', '.join(excluded)}")
    lines.extend(
        [
            "",
            "请先给出补题建议和题目草稿，不要直接写入题库。",
            "题目应围绕上述薄弱知识点，优先补足当前可用题量少的知识点。",
        ]
    )
    return "\n".join(lines)


def _node_gap_reason(selected: list[str], excluded_source: list[str], missing: list[str], suggested_count: int) -> str | None:
    if selected:
        return None
    if suggested_count <= 0:
        return "no_linked_questions"
    if excluded_source and len(excluded_source) >= suggested_count:
        return "only_source_exam_questions"
    if missing:
        return "missing_question_records"
    return "no_available_questions"


def plan_remediation_draft(
    project_root: Path,
    *,
    exam_id: str,
    batch_id: str,
    weak_limit: int = 5,
    practice_per_node: int = 4,
    exclude_source_exam_questions: bool = True,
) -> dict[str, Any]:
    """Preview the actual practice material that would be generated."""
    source_doc = load_exam_workspace(project_root, exam_id)
    suggestions = teaching_suggestions_v1(
        project_root,
        exam_id,
        batch_id,
        weak_limit=max(1, int(weak_limit)),
        practice_per_node=max(1, int(practice_per_node)),
    )
    loaded = _load_project_questions(project_root)
    source_qids = _source_question_ids(source_doc) if exclude_source_exam_questions else set()

    used: set[str] = set()
    selected_order: list[str] = []
    nodes: list[dict[str, Any]] = []
    warnings: list[str] = []

    retell_by_id = {
        str(x.get("node_id")): x
        for x in suggestions.get("retell_priority") or []
        if isinstance(x, dict) and x.get("node_id")
    }

    for draft in suggestions.get("practice_drafts") or []:
        if not isinstance(draft, dict):
            continue
        selected: list[str] = []
        excluded_source: list[str] = []
        missing: list[str] = []
        suggested_ids = [str(qid) for qid in draft.get("suggested_question_ids") or []]

        for qid in suggested_ids:
            if qid in used:
                continue
            if qid in source_qids:
                excluded_source.append(qid)
                continue
            record = loaded.by_qualified.get(qid)
            if record is None:
                missing.append(qid)
                continue
            if _question_kind(record) is None:
                missing.append(qid)
                continue
            selected.append(qid)
            used.add(qid)
            selected_order.append(qid)

        reason = _node_gap_reason(selected, excluded_source, missing, len(suggested_ids))
        if reason:
            warnings.append(f"{draft.get('canonical_name') or draft.get('node_id')} 暂无可直接生成的补练题。")
        node = {
            "node_id": draft.get("node_id"),
            "canonical_name": draft.get("canonical_name"),
            "suggested_count": len(suggested_ids),
            "selected_question_ids": selected,
            "excluded_source_question_ids": excluded_source,
            "missing_question_ids": missing,
            "gap_reason": reason,
        }
        retell = retell_by_id.get(str(node.get("node_id")))
        if retell:
            node["error_rate"] = retell.get("error_rate")
            node["mastery_fuzzy"] = retell.get("mastery_fuzzy")
        nodes.append(node)

    selected_count = len(used)
    payload: dict[str, Any] = {
        "exam_id": exam_id,
        "batch_id": batch_id,
        "selected_count": selected_count,
        "selected_question_ids": selected_order,
        "nodes": nodes,
        "weak_nodes": [
            {
                "node_id": node.get("node_id"),
                "canonical_name": node.get("canonical_name"),
                "error_rate": node.get("error_rate"),
                "mastery_fuzzy": node.get("mastery_fuzzy"),
                "selected_question_ids": node.get("selected_question_ids") or [],
            }
            for node in nodes
        ],
        "low_count": selected_count < LOW_COUNT_THRESHOLD,
        "low_count_threshold": LOW_COUNT_THRESHOLD,
        "warnings": warnings,
        "exclude_source_exam_questions": exclude_source_exam_questions,
    }
    payload["ai_assist_payload"] = {
        "exam_id": exam_id,
        "batch_id": batch_id,
        "selected_count": selected_count,
        "low_count_threshold": LOW_COUNT_THRESHOLD,
        "nodes": nodes,
        "prompt": _build_ai_assist_prompt(payload),
    }
    return payload


def ensure_remediation_practice_template(project_root: Path) -> tuple[str, str]:
    """Ensure the internal mixed-practice template cache exists for remediation drafts."""
    path = project_root / PRACTICE_TEMPLATE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    bundled = Path(__file__).resolve().parent / "bundled_common_templates" / "remediation_practice.yaml"
    if bundled.is_file():
        with bundled.open(encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    else:
        data = {
            "template_id": PRACTICE_TEMPLATE_ID,
            "layout": "single_column",
            "latex_base": "exam-zh-base.tex.j2",
            "sections": [
                {
                    "section_id": PRACTICE_SECTION_ID,
                    "type": "practice",
                    "required_count": 0,
                    "score_per_item": 5,
                }
            ],
            "metadata_defaults": {
                "body_font_size_pt": 11,
                "show_binding_line": False,
                "show_name_column": False,
                "show_page_number_footer": False,
                "show_student_sidebar": False,
                "preamble_notices": "",
                "title_block_style": "default",
                "section_heading_style": "section_star",
                "include_common_math_macros": True,
            },
        }
    if not path.is_file():
        with path.open("w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
    else:
        try:
            with path.open(encoding="utf-8") as f:
                existing = yaml.safe_load(f) or {}
            if isinstance(existing, dict) and existing.get("template_id") == PRACTICE_TEMPLATE_ID:
                sections = existing.get("sections")
                if isinstance(sections, list) and sections:
                    first = sections[0]
                    if isinstance(first, dict):
                        changed = False
                        if first.get("score_per_item") in (None, 0, 0.0):
                            first["score_per_item"] = 5
                            changed = True
                        if "describe" in first:
                            first.pop("describe", None)
                            changed = True
                        md = existing.setdefault("metadata_defaults", {})
                        if isinstance(md, dict):
                            desired_md = data["metadata_defaults"]
                            for key, value in desired_md.items():
                                if md.get(key) != value:
                                    md[key] = value
                                    changed = True
                        if changed:
                            with path.open("w", encoding="utf-8") as f:
                                yaml.safe_dump(existing, f, allow_unicode=True, sort_keys=False)
        except Exception:
            pass
    return PRACTICE_TEMPLATE_ID, PRACTICE_TEMPLATE_PATH


def _unique_export_label(project_root: Path, subject: str, desired: str) -> str:
    base = _norm_text(desired) or "补练"
    candidates = [base] + [f"{base} ({i})" for i in range(2, 100)]
    for cand in candidates:
        try:
            # Probe uniqueness without writing by asking save later to use this label; the real
            # save still performs the authoritative check.
            from solaire.web.exam_workspace_service import label_subject_taken

            if not label_subject_taken(project_root, cand, subject):
                return cand
        except ValueError:
            continue
    return f"{base} ({len(candidates) + 1})"


def _save_with_unique_label(
    project_root: Path,
    *,
    subject: str,
    export_label: str,
    template_ref: str,
    template_path: str,
    selected_items: list[dict[str, Any]],
    source_exam_id: str,
) -> dict[str, Any]:
    base = _norm_text(export_label) or "补练"
    candidates = [_unique_export_label(project_root, subject, base)] + [
        f"{base} ({i})" for i in range(2, 100)
    ]
    last_error: Exception | None = None
    for label in candidates:
        try:
            doc = save_exam_workspace(
                project_root,
                exam_id=None,
                name=f"{label} · {subject}".strip(" ·"),
                subject=subject,
                export_label=label,
                template_ref=template_ref,
                template_path=template_path,
                selected_items=selected_items,
            )
            doc["source_exam_id"] = source_exam_id
            return persist_exam_document(project_root, doc)
        except ValueError as e:
            last_error = e
            continue
    raise ValueError("无法创建补练卷草稿：试卷说明冲突过多，请手动指定新的名称。") from last_error


def create_remediation_draft(
    project_root: Path,
    *,
    exam_id: str,
    batch_id: str,
    weak_limit: int = 5,
    practice_per_node: int = 4,
    exclude_source_exam_questions: bool = True,
    template_ref: str | None = None,
    template_path: str | None = None,
    export_label: str | None = None,
) -> dict[str, Any]:
    """Create an editable exam workspace from diagnosis suggestions."""
    source_doc = load_exam_workspace(project_root, exam_id)
    subject = _source_subject(source_doc, exam_id)
    source_label = _source_export_label(source_doc, exam_id)
    tpl_ref = _norm_text(template_ref) or _norm_text(source_doc.get("template_ref"))
    tpl_path = _norm_text(template_path) or _norm_text(source_doc.get("template_path"))
    if not tpl_ref or not tpl_path:
        raise ValueError("源考试缺少模板信息，无法生成补练卷草稿。")

    template_abs, tpl_path = resolve_template_under_project(project_root, tpl_path, tpl_ref)
    template = load_template(template_abs)
    suggestions = teaching_suggestions_v1(
        project_root,
        exam_id,
        batch_id,
        weak_limit=max(1, int(weak_limit)),
        practice_per_node=max(1, int(practice_per_node)),
    )

    probe = ensure_probe_list_yaml(project_root)
    question_libraries = []
    # The probe stores all project question libraries in ExamConfig shape.
    import yaml

    with probe.open(encoding="utf-8") as f:
        raw_probe = yaml.safe_load(f) or {}
    for lib in raw_probe.get("question_libraries") or []:
        if isinstance(lib, dict):
            question_libraries.append((str(lib.get("namespace") or ""), str(lib.get("path") or "")))
    loaded = load_all_questions(probe, question_libraries)

    source_qids = _source_question_ids(source_doc) if exclude_source_exam_questions else set()
    section_ids_by_type: list[tuple[str, str, int]] = [
        (s.section_id, str(s.type), int(s.required_count)) for s in template.sections if s.type != "text"
    ]
    selected_by_section: dict[str, list[str]] = {sid: [] for sid, _typ, _cap in section_ids_by_type}
    section_capacity: dict[str, int] = {sid: cap for sid, _typ, cap in section_ids_by_type}
    used: set[str] = set()
    warnings: list[str] = []
    weak_nodes: list[dict[str, Any]] = []

    for draft in suggestions.get("practice_drafts") or []:
        if not isinstance(draft, dict):
            continue
        node_selected: list[str] = []
        for qid_raw in draft.get("suggested_question_ids") or []:
            qid = str(qid_raw)
            if qid in used:
                continue
            if qid in source_qids:
                continue
            record = loaded.by_qualified.get(qid)
            qkind = _question_kind(record)
            target_section: str | None = None
            for sid, stype, cap in section_ids_by_type:
                if cap > 0 and len(selected_by_section[sid]) >= section_capacity[sid]:
                    continue
                if _section_accepts(stype, qkind):
                    target_section = sid
                    break
            if target_section is None:
                continue
            selected_by_section[target_section].append(qid)
            used.add(qid)
            node_selected.append(qid)
        if not node_selected and draft.get("count", 0):
            warnings.append(f"{draft.get('canonical_name') or draft.get('node_id')} 未找到可放入当前模板的补练题。")
        weak_nodes.append(
            {
                "node_id": draft.get("node_id"),
                "canonical_name": draft.get("canonical_name"),
                "selected_question_ids": node_selected,
            }
        )

    if not used:
        raise ValueError("没有可用于生成补练卷的题目。请检查知识图谱绑定、题库题型与当前模板是否匹配。")

    retell_by_id = {
        str(x.get("node_id")): x
        for x in suggestions.get("retell_priority") or []
        if isinstance(x, dict) and x.get("node_id")
    }
    for node in weak_nodes:
        retell = retell_by_id.get(str(node.get("node_id")))
        if retell:
            node["error_rate"] = retell.get("error_rate")
            node["mastery_fuzzy"] = retell.get("mastery_fuzzy")

    selected_items = [
        {"section_id": sid, "question_ids": qids}
        for sid, qids in selected_by_section.items()
        if qids
    ]
    desired_label = export_label or f"补练 - {source_label}"
    doc = _save_with_unique_label(
        project_root,
        subject=subject,
        export_label=desired_label,
        template_ref=tpl_ref,
        template_path=tpl_path,
        selected_items=selected_items,
        source_exam_id=exam_id,
    )
    return {
        "exam_id": doc["exam_id"],
        "name": doc.get("name"),
        "selected_count": len(used),
        "weak_nodes": weak_nodes,
        "warnings": warnings,
        "source_exam_id": exam_id,
        "batch_id": batch_id,
    }


def create_remediation_draft(
    project_root: Path,
    *,
    exam_id: str,
    batch_id: str,
    weak_limit: int = 5,
    practice_per_node: int = 4,
    exclude_source_exam_questions: bool = True,
    template_ref: str | None = None,
    template_path: str | None = None,
    export_label: str | None = None,
) -> dict[str, Any]:
    """Create an editable mixed practice workspace from diagnosis suggestions."""
    _ = (template_ref, template_path)
    source_doc = load_exam_workspace(project_root, exam_id)
    subject = _source_subject(source_doc, exam_id)
    source_label = _source_export_label(source_doc, exam_id)
    plan = plan_remediation_draft(
        project_root,
        exam_id=exam_id,
        batch_id=batch_id,
        weak_limit=weak_limit,
        practice_per_node=practice_per_node,
        exclude_source_exam_questions=exclude_source_exam_questions,
    )
    selected_question_ids = [str(qid) for qid in plan.get("selected_question_ids") or []]
    if not selected_question_ids:
        raise ValueError("没有可用于生成练习的题目。可以点击「AI协助补题」生成补题建议，或先补充题库绑定。")

    tpl_ref, tpl_path = ensure_remediation_practice_template(project_root)
    selected_items = [
        {"section_id": PRACTICE_SECTION_ID, "question_ids": selected_question_ids, "score_per_item": 5}
    ]
    desired_label = export_label or f"补练 - {source_label}"
    doc = _save_with_unique_label(
        project_root,
        subject=subject,
        export_label=desired_label,
        template_ref=tpl_ref,
        template_path=tpl_path,
        selected_items=selected_items,
        source_exam_id=exam_id,
    )
    return {
        "exam_id": doc["exam_id"],
        "name": doc.get("name"),
        "selected_count": len(selected_question_ids),
        "weak_nodes": plan.get("weak_nodes") or [],
        "nodes": plan.get("nodes") or [],
        "low_count": plan.get("low_count"),
        "low_count_threshold": plan.get("low_count_threshold"),
        "warnings": plan.get("warnings") or [],
        "ai_assist_payload": plan.get("ai_assist_payload"),
        "source_exam_id": exam_id,
        "batch_id": batch_id,
    }
