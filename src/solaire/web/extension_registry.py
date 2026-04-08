"""Host-level detection and optional winget install for optional desktop extensions."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from typing import Any, TypedDict

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class ExtensionDef(TypedDict, total=False):
    id: str
    name: str
    description: str
    detect: list[str]
    winget_id: str | None
    download_url: str
    install_hint: str | None


EXTENSIONS: list[ExtensionDef] = [
    {
        "id": "latex",
        "name": "PDF 排版引擎",
        "description": "导出试卷为 PDF 文件（MiKTeX / TeX Live）",
        "detect": ["latexmk", "xelatex"],
        "winget_id": "MiKTeX.MiKTeX",
        "download_url": "https://miktex.org/download",
    },
    {
        "id": "pandoc",
        "name": "文档转换",
        "description": "将 Word、HTML 等格式转换为 Markdown",
        "detect": ["pandoc"],
        "winget_id": "JohnMacFarlane.Pandoc",
        "download_url": "https://pandoc.org/installing.html",
    },
    {
        "id": "tesseract",
        "name": "文字识别（OCR）",
        "description": "从图片中提取文字内容",
        "detect": ["tesseract"],
        "winget_id": "UB-Mannheim.TesseractOCR",
        "download_url": "https://github.com/UB-Mannheim/tesseract/wiki",
    },
    {
        "id": "mmdr",
        "name": "图表渲染",
        "description": "将 Mermaid 图表渲染为 SVG 插图",
        "detect": ["mmdr"],
        "winget_id": None,
        "download_url": "https://github.com/niclas-ARC-at/mermaid-rs-renderer",
        "install_hint": "请按官方说明安装图表渲染组件，并确保系统路径中可找到该程序。",
    },
]


_VERSION_TIMEOUT_SEC = 5.0

# Regex per executable name (applied to stdout+stderr, first match wins)
_VERSION_PATTERNS: dict[str, re.Pattern[str]] = {
    "latexmk": re.compile(r"Latexmk.*?(\d[\d.]+)", re.IGNORECASE | re.DOTALL),
    "xelatex": re.compile(r"XeTeX\s+(\d[\d.]+)", re.IGNORECASE),
    "pandoc": re.compile(r"pandoc\s+(\d[\d.]+)", re.IGNORECASE),
    "tesseract": re.compile(r"tesseract\s+(\d[\d.]+)", re.IGNORECASE),
    "mmdr": re.compile(r"(\d[\d.]+)"),
}


def _run_version(exe_path: str, name: str) -> str | None:
    """Return a short version string or None."""
    try:
        r = subprocess.run(
            [exe_path, "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_VERSION_TIMEOUT_SEC,
        )
        blob = ((r.stdout or "") + "\n" + (r.stderr or "")).strip()
        if not blob:
            return None
        pat = _VERSION_PATTERNS.get(name)
        if pat:
            m = pat.search(blob)
            if m:
                return m.group(1)
        # Fallback: first line with digits
        for line in blob.splitlines():
            m2 = re.search(r"(\d+\.\d+[\d.]*)", line)
            if m2:
                return m2.group(1)
        return None
    except (OSError, subprocess.TimeoutExpired, subprocess.SubprocessError):
        return None


def _winget_available() -> bool:
    return sys.platform == "win32" and shutil.which("winget") is not None


def _pytesseract_available() -> bool:
    try:
        import pytesseract  # noqa: F401

        return True
    except ImportError:
        return False


def detect_executable(name: str) -> dict[str, Any]:
    path = shutil.which(name)
    if not path:
        return {"name": name, "on_path": False, "path": None, "version": None}
    ver = _run_version(path, name)
    return {"name": name, "on_path": True, "path": path, "version": ver}


def detect_extension(ext: ExtensionDef) -> dict[str, Any]:
    """Single extension status for API."""
    exes = [detect_executable(n) for n in ext["detect"]]
    ready = all(e["on_path"] for e in exes)
    winget_id = ext.get("winget_id")
    can_auto = _winget_available() and bool(winget_id)

    out: dict[str, Any] = {
        "id": ext["id"],
        "name": ext["name"],
        "description": ext["description"],
        "download_url": ext["download_url"],
        "install_hint": ext.get("install_hint"),
        "executables": exes,
        "ready": ready,
        "can_auto_install": can_auto,
        "platform": sys.platform,
        "winget_on_path": shutil.which("winget") is not None if sys.platform == "win32" else None,
    }

    if ext["id"] == "tesseract":
        out["python_ocr_ready"] = _pytesseract_available()
        # Full OCR in app needs both engine and Python binding
        out["ocr_ready"] = ready and out["python_ocr_ready"]

    return out


def detect_all() -> dict[str, Any]:
    """Return all extensions and a summary."""
    items = [detect_extension(e) for e in EXTENSIONS]
    return {"extensions": items}


def install_via_winget(winget_id: str) -> dict[str, Any]:
    """Start winget install (non-blocking). Windows only."""
    if sys.platform != "win32":
        return {"ok": False, "message": "当前系统不支持此一键安装，请按页面说明手动安装。"}
    winget = shutil.which("winget")
    if not winget:
        return {
            "ok": False,
            "message": "未找到系统自带的应用安装器，请使用「手动下载」按官方说明安装。",
        }
    cmd = [
        winget,
        "install",
        winget_id,
        "--accept-source-agreements",
        "--accept-package-agreements",
    ]
    try:
        subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    except OSError as e:
        return {"ok": False, "message": f"无法启动安装流程：{e}"}
    return {
        "ok": True,
        "message": "已尝试启动安装程序，请按系统提示完成安装；完成后可点击「重新检测」。",
    }


def install_extension(ext_id: str) -> dict[str, Any]:
    """Start install for a registered extension id."""
    ext = next((e for e in EXTENSIONS if e["id"] == ext_id), None)
    if ext is None:
        return {"ok": False, "message": "未知的扩展标识。"}
    winget_id = ext.get("winget_id")
    if not winget_id:
        hint = ext.get("install_hint") or "请使用「手动下载」或官方文档完成安装。"
        return {"ok": False, "message": hint}
    return install_via_winget(winget_id)
