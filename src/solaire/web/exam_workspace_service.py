"""Exam workspaces under ``exams/<考试标签>/<学科>/`` — ``exam.yaml`` + ``config.json``."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import yaml

from solaire.common.security import assert_within_project
from solaire.exam_compiler.facade import SelectedSection

from solaire.web.draft_service import (
    _section_dump,
    _sections_from_raw,
    normalize_draft_name,
)

ExamStatus = Literal["draft", "exported"]

_WIN_FORBIDDEN = frozenset('<>:"/\\|?*')
# Windows 保留设备名（不含扩展名时）
_WIN_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL", *{f"COM{i}" for i in range(1, 10)}, *{f"LPT{i}" for i in range(1, 10)}}
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _exams_root(project_root: Path) -> Path:
    d = project_root / "exams"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _norm_label(s: str) -> str:
    return " ".join((s or "").strip().split())


def label_subject_pair(export_label: str, subject: str) -> tuple[str, str]:
    return (_norm_label(export_label), _norm_label(subject))


def _identity_nonempty(pair: tuple[str, str]) -> bool:
    return bool(pair[0]) and bool(pair[1])


def _same_identity(a: tuple[str, str], b: tuple[str, str]) -> bool:
    if not _identity_nonempty(a) or not _identity_nonempty(b):
        return False
    return a == b


def _safe_fs_segment(normalized_text: str, *, field_name: str) -> str:
    """
    将已规范化的标签/学科文本转为单层目录名。
    若含 Windows 非法字符或规范化后不可用，抛出 ValueError（业务化提示）。
    """
    s = normalized_text.strip()
    if not s:
        raise ValueError(f"{field_name}不能为空。")
    out: list[str] = []
    for ch in s:
        if ch in _WIN_FORBIDDEN or ord(ch) < 32:
            out.append("－")
        else:
            out.append(ch)
    seg = "".join(out).strip()
    # 去掉末尾点与空格（Windows 不允许）
    seg = seg.rstrip(" .")
    seg = re.sub(r"[\s.]+$", "", seg)
    if not seg:
        raise ValueError(f"{field_name}在去除不可用符号后为空，请调整后再试。")
    if len(seg) > 120:
        raise ValueError(f"{field_name}过长，请缩短后再试（目录名最多 120 个字符）。")
    upper = seg.upper()
    if upper in _WIN_RESERVED_NAMES or upper.split(".")[0].upper() in _WIN_RESERVED_NAMES:
        raise ValueError(f"{field_name}「{seg}」不可用（与系统保留名称冲突），请调整后再试。")
    return seg


def segments_for_identity(export_label: str, subject: str) -> tuple[str, str]:
    """由「试卷说明 + 学科」得到两级目录名；非法则抛出 ValueError。"""
    el, sub = label_subject_pair(export_label, subject)
    if not _identity_nonempty((el, sub)):
        raise ValueError("请填写试卷说明与学科。")
    return (
        _safe_fs_segment(el, field_name="试卷说明"),
        _safe_fs_segment(sub, field_name="学科"),
    )


def exam_id_from_labels(export_label: str, subject: str) -> str:
    a, b = segments_for_identity(export_label, subject)
    return f"{a}/{b}"


def _split_exam_path(exam_id: str) -> tuple[str, str]:
    s = (exam_id or "").strip().replace("\\", "/")
    parts = [p for p in s.split("/") if p and p != "."]
    if len(parts) != 2:
        raise ValueError("无效的考试标识")
    a, b = parts[0], parts[1]
    if ".." in a or ".." in b:
        raise ValueError("无效的考试标识")
    return a, b


def _safe_exam_id(exam_id: str) -> str:
    """校验并规范化 ``标签段/学科段`` 形式的 exam_id。"""
    a, b = _split_exam_path(exam_id)
    if not a or not b:
        raise ValueError("无效的考试标识")
    return f"{a}/{b}"


def workspace_dir(project_root: Path, exam_id: str) -> Path:
    a, b = _split_exam_path(exam_id)
    d = (_exams_root(project_root) / a / b).resolve()
    assert_within_project(project_root, d)
    return d


def exam_yaml_path(project_root: Path, exam_id: str) -> Path:
    return workspace_dir(project_root, exam_id) / "exam.yaml"


def config_json_path(project_root: Path, exam_id: str) -> Path:
    return workspace_dir(project_root, exam_id) / "config.json"


def _read_config(project_root: Path, exam_id: str) -> dict[str, Any] | None:
    p = config_json_path(project_root, exam_id)
    if not p.is_file():
        return None
    try:
        with p.open(encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _write_config(project_root: Path, exam_id: str, cfg: dict[str, Any]) -> None:
    p = config_json_path(project_root, exam_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _default_config(
    *,
    exam_id: str,
    status: ExamStatus,
    export_label: str,
    subject: str,
    display_name: str,
    source_exam_id: str | None,
    created_at: str,
    updated_at: str,
) -> dict[str, Any]:
    return {
        "exam_id": exam_id,
        "status": status,
        "exam_label": export_label,
        "subject": subject,
        "display_name": display_name,
        "source_exam_id": source_exam_id,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def assert_unique_exam_identity(
    project_root: Path,
    export_label: str,
    subject: str,
    *,
    exclude_exam_id: str | None = None,
) -> None:
    """若已存在相同的「试卷说明」与「学科」，抛出 ``ValueError``。"""
    if label_subject_taken(project_root, export_label, subject, exclude_exam_id=exclude_exam_id):
        raise ValueError("已存在相同的「试卷说明」与「学科」，请修改后再试。")


def label_subject_taken(
    project_root: Path,
    export_label: str,
    subject: str,
    *,
    exclude_exam_id: str | None = None,
) -> bool:
    """True if another workspace already uses the same non-empty 试卷说明 + 学科."""
    want = label_subject_pair(export_label, subject)
    if not _identity_nonempty(want):
        return False
    excl = _safe_exam_id(exclude_exam_id) if exclude_exam_id else None
    root = _exams_root(project_root)
    if not root.is_dir():
        return False
    for label_dir in root.iterdir():
        if not label_dir.is_dir():
            continue
        for subj_dir in label_dir.iterdir():
            if not subj_dir.is_dir():
                continue
            eid = f"{label_dir.name}/{subj_dir.name}"
            if excl and eid == excl:
                continue
            cfg = _read_config(project_root, eid)
            if cfg:
                got = label_subject_pair(str(cfg.get("exam_label") or ""), str(cfg.get("subject") or ""))
            else:
                yp = subj_dir / "exam.yaml"
                if not yp.is_file():
                    continue
                try:
                    with yp.open(encoding="utf-8") as f:
                        raw = yaml.safe_load(f)
                except OSError:
                    continue
                if not isinstance(raw, dict):
                    continue
                got = label_subject_pair(str(raw.get("export_label") or ""), str(raw.get("subject") or ""))
            if _same_identity(want, got):
                return True
    return False


def list_exam_workspaces(project_root: Path) -> list[dict[str, Any]]:
    """Newest ``updated_at`` first."""
    root = _exams_root(project_root)
    if not root.is_dir():
        return []
    rows: list[tuple[float, dict[str, Any]]] = []
    for label_dir in root.iterdir():
        if not label_dir.is_dir():
            continue
        for subj_dir in label_dir.iterdir():
            if not subj_dir.is_dir():
                continue
            eid = f"{label_dir.name}/{subj_dir.name}"
            cfg = _read_config(project_root, eid)
            yp = exam_yaml_path(project_root, eid)
            if not yp.is_file():
                continue
            try:
                mtime = yp.stat().st_mtime
                if cfg:
                    updated = str(cfg.get("updated_at") or "")
                    status = str(cfg.get("status") or "draft")
                    display = str(cfg.get("display_name") or eid)
                    el = str(cfg.get("exam_label") or "")
                    sub = str(cfg.get("subject") or "")
                else:
                    with yp.open(encoding="utf-8") as f:
                        raw = yaml.safe_load(f)
                    if not isinstance(raw, dict):
                        continue
                    updated = str(raw.get("updated_at") or "")
                    status = "draft"
                    display = str(raw.get("name") or eid)
                    el = str(raw.get("export_label") or "")
                    sub = str(raw.get("subject") or "")
                rows.append(
                    (
                        mtime,
                        {
                            "exam_id": eid,
                            "name": display,
                            "subject": sub,
                            "export_label": el,
                            "template_ref": None,
                            "template_path": None,
                            "updated_at": updated,
                            "status": status if status in ("draft", "exported") else "draft",
                        },
                    ),
                )
            except OSError:
                continue
    rows.sort(key=lambda x: x[0], reverse=True)
    out = [r[1] for r in rows]
    for row in out:
        eid = row["exam_id"]
        yp = exam_yaml_path(project_root, eid)
        try:
            with yp.open(encoding="utf-8") as f:
                raw = yaml.safe_load(f)
            if isinstance(raw, dict):
                row["template_ref"] = raw.get("template_ref")
                row["template_path"] = raw.get("template_path")
        except OSError:
            pass
    return out


def load_exam_workspace(project_root: Path, exam_id: str) -> dict[str, Any]:
    """Load ``exam.yaml`` for the compose UI."""
    eid = _safe_exam_id(exam_id)
    path = exam_yaml_path(project_root, eid)
    assert_within_project(project_root, path)
    if not path.is_file():
        raise FileNotFoundError(f"考试工作区不存在：{exam_id}")
    with path.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    if not isinstance(raw, dict):
        raise ValueError("无效的考试工作区文件")
    doc = dict(raw)
    if "exam_id" not in doc:
        doc["exam_id"] = eid
    doc["exam_id"] = str(doc["exam_id"])
    return doc


def delete_exam_workspace(project_root: Path, exam_id: str) -> None:
    """删除 ``exams/<标签>/<学科>/``。"""
    eid = _safe_exam_id(exam_id)
    d = workspace_dir(project_root, eid)
    assert_within_project(project_root, d)
    if d.is_dir():
        shutil.rmtree(d)


def _build_exam_doc(
    *,
    exam_id: str,
    name: str,
    subject: str,
    export_label: str,
    template_ref: str,
    template_path: str,
    selected_items: list[SelectedSection],
    created_at: str,
    updated_at: str,
    source_exam_id: str | None = None,
) -> dict[str, Any]:
    tpl_rel = template_path.replace("\\", "/").strip().lstrip("/")
    doc: dict[str, Any] = {
        "exam_id": exam_id,
        "name": name,
        "subject": subject.strip(),
        "export_label": export_label.strip(),
        "template_ref": template_ref.strip(),
        "template_path": tpl_rel,
        "selected_items": [_section_dump(s) for s in selected_items],
        "created_at": created_at,
        "updated_at": updated_at,
    }
    if source_exam_id:
        doc["source_exam_id"] = source_exam_id
    return doc


def save_exam_workspace(
    project_root: Path,
    *,
    exam_id: str | None,
    name: str | None,
    subject: str,
    export_label: str,
    template_ref: str,
    template_path: str,
    selected_items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Create or update workspace; returns stored document."""
    tpl_rel = template_path.replace("\\", "/").strip().lstrip("/")
    sections = _sections_from_raw(selected_items)
    now = _utc_now_iso()

    explicit_raw = (name or "").strip()
    default_name = f"{export_label or '试卷'} · {subject or ''}".strip(" ·")
    if not default_name:
        default_name = "未命名试卷"
    if explicit_raw:
        final_name = normalize_draft_name(explicit_raw)
        if not final_name:
            final_name = default_name
    else:
        final_name = default_name

    if exam_id:
        eid = _safe_exam_id(exam_id)
        try:
            new_eid = exam_id_from_labels(export_label, subject)
        except ValueError as e:
            raise ValueError(str(e)) from e
        if new_eid != eid:
            pair = label_subject_pair(export_label, subject)
            if _identity_nonempty(pair):
                assert_unique_exam_identity(project_root, export_label, subject, exclude_exam_id=eid)
            old_dir = workspace_dir(project_root, eid)
            new_dir = workspace_dir(project_root, new_eid)
            if new_dir.resolve() != old_dir.resolve():
                new_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(old_dir), str(new_dir))
            eid = new_eid

        wdir = workspace_dir(project_root, eid)
        yp = wdir / "exam.yaml"
        assert_within_project(project_root, yp)
        if not yp.is_file():
            raise FileNotFoundError(f"考试工作区不存在：{exam_id}")
        created = now
        cfg0 = _read_config(project_root, eid)
        with yp.open(encoding="utf-8") as f:
            old = yaml.safe_load(f)
        if isinstance(old, dict) and old.get("created_at"):
            created = str(old["created_at"])
        src_ex = old.get("source_exam_id") if isinstance(old, dict) else None
        if cfg0 and cfg0.get("source_exam_id"):
            src_ex = str(cfg0.get("source_exam_id"))
        pair = label_subject_pair(export_label, subject)
        if _identity_nonempty(pair):
            assert_unique_exam_identity(project_root, export_label, subject, exclude_exam_id=eid)
        doc = _build_exam_doc(
            exam_id=eid,
            name=final_name,
            subject=subject,
            export_label=export_label,
            template_ref=template_ref,
            template_path=tpl_rel,
            selected_items=sections,
            created_at=created,
            updated_at=now,
            source_exam_id=str(src_ex) if src_ex else None,
        )
        status: ExamStatus = "exported" if (cfg0 or {}).get("status") == "exported" else "draft"
        _write_exam_yaml(project_root, doc)
        _write_config(
            project_root,
            eid,
            _default_config(
                exam_id=eid,
                status=status,
                export_label=doc["export_label"],
                subject=doc["subject"],
                display_name=final_name,
                source_exam_id=str(src_ex) if src_ex else None,
                created_at=created,
                updated_at=now,
            ),
        )
        return doc

    pair = label_subject_pair(export_label, subject)
    if _identity_nonempty(pair):
        assert_unique_exam_identity(project_root, export_label, subject)
    try:
        new_id = exam_id_from_labels(export_label, subject)
    except ValueError as e:
        raise ValueError(str(e)) from e
    wdir = workspace_dir(project_root, new_id)
    wdir.mkdir(parents=True, exist_ok=True)
    doc = _build_exam_doc(
        exam_id=new_id,
        name=final_name,
        subject=subject,
        export_label=export_label,
        template_ref=template_ref,
        template_path=tpl_rel,
        selected_items=sections,
        created_at=now,
        updated_at=now,
    )
    _write_exam_yaml(project_root, doc)
    _write_config(
        project_root,
        new_id,
        _default_config(
            exam_id=new_id,
            status="draft",
            export_label=doc["export_label"],
            subject=doc["subject"],
            display_name=final_name,
            source_exam_id=None,
            created_at=now,
            updated_at=now,
        ),
    )
    return doc


def _write_exam_yaml(project_root: Path, doc: dict[str, Any]) -> None:
    eid = _safe_exam_id(str(doc.get("exam_id") or ""))
    if not eid:
        raise ValueError("exam_id required")
    path = exam_yaml_path(project_root, eid)
    assert_within_project(project_root, path)
    path.parent.mkdir(parents=True, exist_ok=True)
    to_store = {k: v for k, v in doc.items() if k != "draft_id"}
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(to_store, f, allow_unicode=True, sort_keys=False)


def persist_exam_document(project_root: Path, doc: dict[str, Any]) -> dict[str, Any]:
    """Write a full exam dict (e.g. from history copy) to disk."""
    exam_id = str(doc.get("exam_id") or "").strip()
    if not exam_id:
        raise ValueError("exam_id required")
    doc = dict(doc)
    doc.pop("draft_id", None)
    eid = _safe_exam_id(exam_id)
    doc["exam_id"] = eid
    pair = label_subject_pair(str(doc.get("export_label") or ""), str(doc.get("subject") or ""))
    if _identity_nonempty(pair):
        assert_unique_exam_identity(project_root, doc["export_label"], doc["subject"], exclude_exam_id=eid)
    now = _utc_now_iso()
    doc.setdefault("created_at", now)
    doc["updated_at"] = now
    _write_exam_yaml(project_root, doc)
    cfg = _read_config(project_root, eid) or {}
    status = cfg.get("status") if cfg.get("status") in ("draft", "exported") else "draft"
    src_ex = doc.get("source_exam_id") or cfg.get("source_exam_id")
    _write_config(
        project_root,
        eid,
        _default_config(
            exam_id=eid,
            status=status,
            export_label=str(doc.get("export_label") or ""),
            subject=str(doc.get("subject") or ""),
            display_name=str(doc.get("name") or eid),
            source_exam_id=str(src_ex) if src_ex else None,
            created_at=str(cfg.get("created_at") or doc["created_at"]),
            updated_at=now,
        ),
    )
    return doc


def exam_document_from_exam(
    project_root: Path,
    source_exam_id: str,
    *,
    export_label: str,
) -> dict[str, Any]:
    """Build new workspace document from another ``exams/…/…/exam.yaml`` (not written)."""
    d = load_exam_workspace(project_root, source_exam_id)
    subject = str(d.get("subject") or "").strip()
    el = _norm_label(export_label)
    try:
        new_id = exam_id_from_labels(el, subject)
    except ValueError as e:
        raise ValueError(str(e)) from e
    display_name = f"{el} · {subject}".strip(" ·") if el or subject else "试卷"
    doc: dict[str, Any] = {
        "exam_id": new_id,
        "name": display_name,
        "subject": subject,
        "export_label": el,
        "template_ref": d.get("template_ref") or "",
        "template_path": d.get("template_path") or "",
        "selected_items": d.get("selected_items") or [],
        "created_at": d.get("created_at"),
        "updated_at": d.get("updated_at"),
        "source_exam_id": _safe_exam_id(source_exam_id),
    }
    return doc


def create_workspace_from_exam(
    project_root: Path,
    source_exam_id: str,
    *,
    export_label: str,
) -> dict[str, Any]:
    """Copy an existing exam folder into a new ``exams/<标签>/<学科>/`` directory。"""
    doc = exam_document_from_exam(project_root, source_exam_id, export_label=export_label)
    return persist_exam_document(project_root, doc)


def mark_exported(project_root: Path, exam_id: str) -> None:
    """导出成功后：``status=exported``。"""
    eid = _safe_exam_id(exam_id)
    cfg = _read_config(project_root, eid) or {}
    yp = exam_yaml_path(project_root, eid)
    if yp.is_file():
        try:
            with yp.open(encoding="utf-8") as f:
                raw = yaml.safe_load(f)
            if isinstance(raw, dict):
                cfg.setdefault("exam_label", str(raw.get("export_label") or ""))
                cfg.setdefault("subject", str(raw.get("subject") or ""))
                cfg.setdefault("display_name", str(raw.get("name") or eid))
        except OSError:
            pass
    if not cfg.get("created_at"):
        cfg["created_at"] = _utc_now_iso()
    now = _utc_now_iso()
    cfg["exam_id"] = eid
    cfg["status"] = "exported"
    cfg["updated_at"] = now
    cfg.pop("last_export_result_id", None)
    for k in ("exam_label", "subject", "display_name", "source_exam_id"):
        if k not in cfg:
            cfg[k] = ""
    _write_config(project_root, eid, cfg)
    yp = exam_yaml_path(project_root, eid)
    if yp.is_file():
        try:
            with yp.open(encoding="utf-8") as f:
                raw = yaml.safe_load(f)
            if isinstance(raw, dict):
                raw["updated_at"] = now
                with yp.open("w", encoding="utf-8") as f:
                    yaml.safe_dump(
                        {k: v for k, v in raw.items() if k != "draft_id"},
                        f,
                        allow_unicode=True,
                        sort_keys=False,
                    )
        except OSError:
            pass


def save_exam_workspace_after_export_failure(
    project_root: Path,
    *,
    template_ref: str,
    template_path: str,
    export_label: str,
    subject: str,
    selected_items: list[dict[str, Any]],
) -> dict[str, Any]:
    """导出失败时写入新的 ``exams/…/…/`` 草稿（试卷说明带「导出失败」后缀以避免冲突）。"""
    base = export_label.strip() or "试卷"
    candidates = [f"{base}（导出失败）"] + [f"{base}（导出失败{k}）" for k in range(2, 50)]
    for el in candidates:
        try:
            return save_exam_workspace(
                project_root,
                exam_id=None,
                name=None,
                subject=subject,
                export_label=el,
                template_ref=template_ref,
                template_path=template_path,
                selected_items=selected_items,
            )
        except ValueError:
            continue
    raise ValueError("无法为导出失败快照分配唯一的试卷说明")


def import_legacy_draft_yaml(project_root: Path, draft_yaml: Path, *, suffix: str | None = None) -> dict[str, Any]:
    """
    Import a single ``.solaire/drafts/*.yaml`` into ``exams/<标签>/<学科>/``.

    Used by migration; on label+subject conflict, append ``suffix`` to 试卷说明.
    """
    with draft_yaml.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    if not isinstance(raw, dict):
        raise ValueError("invalid draft yaml")
    export_label = str(raw.get("export_label") or "").strip()
    subject = str(raw.get("subject") or "").strip()
    if suffix:
        export_label = f"{export_label}{suffix}".strip() if export_label else suffix.strip()
    # resolve conflicts by mutating label
    n = 2
    while _identity_nonempty(label_subject_pair(export_label, subject)) and label_subject_taken(
        project_root, export_label, subject
    ):
        base = str(raw.get("export_label") or "试卷").strip() or "试卷"
        export_label = f"{base}（迁移{n}）"
        n += 1
    now = _utc_now_iso()
    created = str(raw.get("created_at") or now)
    try:
        new_id = exam_id_from_labels(export_label, subject)
    except ValueError:
        new_id = exam_id_from_labels(f"{export_label}（迁移）", subject or "科目")
    doc: dict[str, Any] = {
        "exam_id": new_id,
        "name": str(raw.get("name") or "未命名试卷"),
        "subject": subject,
        "export_label": export_label,
        "template_ref": str(raw.get("template_ref") or ""),
        "template_path": str(raw.get("template_path") or "").replace("\\", "/").strip().lstrip("/"),
        "selected_items": raw.get("selected_items") or [],
        "created_at": created,
        "updated_at": str(raw.get("updated_at") or now),
    }
    workspace_dir(project_root, new_id).mkdir(parents=True, exist_ok=True)
    _write_exam_yaml(project_root, doc)
    _write_config(
        project_root,
        new_id,
        _default_config(
            exam_id=new_id,
            status="draft",
            export_label=doc["export_label"],
            subject=doc["subject"],
            display_name=doc["name"],
            source_exam_id=None,
            created_at=created,
            updated_at=now,
        ),
    )
    return {"exam_id": new_id, "from_file": draft_yaml.name}
