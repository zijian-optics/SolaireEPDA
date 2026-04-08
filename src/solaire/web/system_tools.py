"""Host-level helpers for TeX / PDF toolchain detection (Windows-focused)."""

from __future__ import annotations

import shutil
import subprocess
import sys
from typing import Any


def tex_status() -> dict[str, Any]:
    """Return whether latexmk / xelatex are discoverable on PATH."""
    latexmk = shutil.which("latexmk")
    xelatex = shutil.which("xelatex")
    winget: str | None = None
    if sys.platform == "win32":
        winget = shutil.which("winget")
    ready = latexmk is not None and xelatex is not None
    return {
        "platform": sys.platform,
        "latexmk_on_path": latexmk is not None,
        "xelatex_on_path": xelatex is not None,
        "winget_on_path": winget is not None if sys.platform == "win32" else None,
        "pdf_engine_ready": ready,
    }


def tex_install_miktex_via_winget() -> dict[str, Any]:
    """Start winget install for MiKTeX (non-blocking). Windows only."""
    from solaire.web.extension_registry import install_via_winget

    if sys.platform != "win32":
        return {"ok": False, "message": "当前系统不支持此一键安装，请按页面说明手动安装 PDF 排版组件。"}
    r = install_via_winget("MiKTeX.MiKTeX")
    if not r.get("ok") and r.get("message") == "未找到系统自带的应用安装器，请使用「手动下载」按官方说明安装。":
        return {
            "ok": False,
            "message": "未找到系统自带的应用安装器，请从 MiKTeX 官网下载安装包手动安装。",
        }
    return r
