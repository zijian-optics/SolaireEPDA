"""Host-level helpers for TeX / PDF toolchain detection (Windows-focused)."""

from __future__ import annotations

import sys
from typing import Any


def tex_status() -> dict[str, Any]:
    """Return whether latexmk / xelatex are discoverable (includes manual paths from settings)."""
    from solaire.web.extension_registry import tex_toolchain_status

    return tex_toolchain_status()


def tex_install_miktex_via_winget() -> dict[str, Any]:
    """Start winget install for MiKTeX (non-blocking). Windows only."""
    from solaire.web.extension_registry import install_via_winget

    if sys.platform != "win32":
        return {"ok": False, "message": "当前系统不支持此一键安装，请按页面说明手动安装 PDF 排版组件。"}
    r = install_via_winget("MiKTeX.MiKTeX", display_label="MiKTeX")
    if not r.get("ok") and r.get("message") == "未找到系统自带的应用安装器，请使用「手动下载」按官方说明安装。":
        return {
            "ok": False,
            "message": "未找到系统自带的应用安装器，请从 MiKTeX 官网下载安装包手动安装。",
        }
    return r
