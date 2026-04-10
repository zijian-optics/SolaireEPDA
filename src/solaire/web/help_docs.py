"""Application help: Markdown bundled under solaire.web.assets.help_docs with manifest allowlist."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import HTTPException


def get_solaire_doc_dir() -> Path:
    """Root directory containing help-manifest.json and help markdown folders."""
    override = os.environ.get("SOLAIRE_HELP_DOC_ROOT")
    if override:
        return Path(override).expanduser().resolve()

    # Same package as this module: stable under site-packages, editable install, or PyInstaller.
    pkg_dir = Path(__file__).resolve().parent / "assets" / "help_docs"
    if (pkg_dir / "help-manifest.json").is_file():
        return pkg_dir

    # Legacy repo layout (e.g. partial checkout): src/solaire_doc next to solaire package.
    legacy = Path(__file__).resolve().parents[2] / "solaire_doc"
    if (legacy / "help-manifest.json").is_file():
        return legacy

    return pkg_dir


def _load_manifest_raw() -> dict[str, Any]:
    root = get_solaire_doc_dir()
    manifest_path = root / "help-manifest.json"
    if not manifest_path.is_file():
        raise HTTPException(status_code=500, detail="手册清单不可用")
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail="手册清单格式错误") from e
    pages = data.get("pages")
    if not isinstance(pages, list):
        raise HTTPException(status_code=500, detail="手册清单缺少目录")
    return data


_ASSET_SUFFIXES = frozenset({".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"})


def resolve_help_asset(rel: str) -> Path:
    """Return a file under help_docs/assets/ (for diagrams referenced from help Markdown)."""
    rel = rel.strip().replace("\\", "/").lstrip("/")
    if not rel or any(part == ".." for part in rel.split("/")):
        raise HTTPException(status_code=400, detail="无效资源路径")
    root = (get_solaire_doc_dir() / "assets").resolve()
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError as e:
        raise HTTPException(status_code=403, detail="资源路径越界") from e
    if not target.is_file():
        raise HTTPException(status_code=404, detail="资源不存在")
    if target.suffix.lower() not in _ASSET_SUFFIXES:
        raise HTTPException(status_code=404, detail="不支持的资源类型")
    return target


def _resolve_allowed_file(rel: str) -> Path:
    root = get_solaire_doc_dir()
    rel = rel.strip().replace("\\", "/").lstrip("/")
    if not rel or any(part == ".." for part in rel.split("/")):
        raise HTTPException(status_code=400, detail="无效路径")
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError as e:
        raise HTTPException(status_code=403, detail="路径越界") from e
    return target


def help_index() -> dict[str, Any]:
    data = _load_manifest_raw()
    pages = data["pages"]
    out: list[dict[str, str]] = []
    for p in pages:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        title = p.get("title")
        path = p.get("path")
        audience = p.get("audience") or "user"
        if not isinstance(pid, str) or not isinstance(title, str) or not isinstance(path, str):
            continue
        if not pid or not title or not path:
            continue
        sec_raw = p.get("section")
        valid_sections = ("intro", "guide", "advanced")
        if isinstance(sec_raw, str) and sec_raw in valid_sections:
            section = sec_raw
        elif sec_raw == "automation":
            # 兼容旧版 manifest：历史上把图谱 HTTP 接口归为 automation
            section = "advanced"
        elif audience == "ai":
            section = "advanced"
        elif audience == "dev":
            section = "advanced"
        else:
            section = "guide"
        out.append({"id": pid, "title": title, "audience": audience, "section": section})
    return {"pages": out}


def help_page(page_id: str) -> dict[str, Any]:
    data = _load_manifest_raw()
    entry: dict[str, Any] | None = None
    for p in data["pages"]:
        if isinstance(p, dict) and p.get("id") == page_id:
            entry = p
            break
    if entry is None:
        raise HTTPException(status_code=404, detail="未找到该手册条目")
    path = entry.get("path")
    if not isinstance(path, str) or not path.strip():
        raise HTTPException(status_code=500, detail="手册条目无效")
    abs_path = _resolve_allowed_file(path)
    if not abs_path.is_file():
        raise HTTPException(status_code=404, detail="手册文件缺失")
    markdown = abs_path.read_text(encoding="utf-8")
    title = entry.get("title")
    if not isinstance(title, str):
        title = ""
    aud = entry.get("audience") or "user"
    return {
        "id": page_id,
        "title": title,
        "audience": aud if isinstance(aud, str) else "user",
        "markdown": markdown,
    }
