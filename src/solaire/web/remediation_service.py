"""Create editable remediation exam workspaces from score diagnosis results."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.edu_analysis.diagnosis import teaching_suggestions_v1
from solaire.exam_compiler.facade import QuestionGroupRecord, QuestionItem, load_all_questions, load_template
from solaire.web.exam_service import ensure_probe_list_yaml
from solaire.web.exam_workspace_service import (
    load_exam_workspace,
    persist_exam_document,
    resolve_template_under_project,
    save_exam_workspace,
)


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
