"""Host-level detection and optional winget install for optional desktop extensions."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, TypedDict

from solaire.web import extension_preferences

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


def _exe_in_dir(bin_dir: Path, exe_name: str) -> Path | None:
    """Find exe_name or exe_name.exe under bin_dir (non-recursive)."""
    for cand in (bin_dir / exe_name, bin_dir / f"{exe_name}.exe"):
        try:
            if cand.is_file():
                return cand.resolve()
        except OSError:
            continue
    return None


def _resolve_manual_exe_path(ext_id: str, exe_name: str, manual: dict[str, Any] | None) -> str | None:
    """Return absolute path to exe from saved manual prefs, or None."""
    if not manual:
        return None
    if ext_id == "latex":
        bd = manual.get("bin_dir")
        if isinstance(bd, str) and bd.strip():
            try:
                pdir = Path(bd).expanduser().resolve()
            except OSError:
                return None
            if pdir.is_dir():
                hit = _exe_in_dir(pdir, exe_name)
                return str(hit) if hit else None
        key = manual.get(exe_name)
        if isinstance(key, str) and key.strip():
            try:
                p = Path(key).expanduser().resolve()
            except OSError:
                return None
            if p.is_file():
                return str(p)
        return None

    val = manual.get(exe_name) if isinstance(manual.get(exe_name), str) else manual.get("path")
    if not isinstance(val, str) or not val.strip():
        return None
    try:
        p = Path(val).expanduser().resolve()
    except OSError:
        return None
    if p.is_file():
        return str(p)
    if p.is_dir():
        hit = _exe_in_dir(p, exe_name)
        return str(hit) if hit else None
    return None


def _manual_paths_for_api(
    ext_id: str,
    manual: dict[str, Any] | None,
    detect_names: list[str],
) -> dict[str, str | None]:
    """Expose what the user configured (paths may be invalid until next save)."""
    if not manual:
        return {}
    out: dict[str, str | None] = {}
    if ext_id == "latex":
        bd = manual.get("bin_dir")
        out["bin_dir"] = str(Path(bd).expanduser().resolve()) if isinstance(bd, str) and bd.strip() else None
        for k in ("latexmk", "xelatex"):
            v = manual.get(k)
            out[k] = str(Path(v).expanduser().resolve()) if isinstance(v, str) and v.strip() else None
        return out
    for k in ("path", *detect_names):
        if k in manual and isinstance(manual[k], str) and manual[k].strip():
            try:
                out[k] = str(Path(manual[k]).expanduser().resolve())
            except OSError:
                out[k] = manual[k]
    return out


def detect_executable(ext_id: str, exe_name: str, manual: dict[str, Any] | None) -> dict[str, Any]:
    manual_path = _resolve_manual_exe_path(ext_id, exe_name, manual)
    if manual_path:
        ver = _run_version(manual_path, exe_name)
        return {
            "name": exe_name,
            "on_path": True,
            "path": manual_path,
            "version": ver,
            "resolved_from": "manual",
        }
    path = shutil.which(exe_name)
    if not path:
        return {
            "name": exe_name,
            "on_path": False,
            "path": None,
            "version": None,
            "resolved_from": "system",
        }
    ver = _run_version(path, exe_name)
    return {
        "name": exe_name,
        "on_path": True,
        "path": path,
        "version": ver,
        "resolved_from": "system",
    }


def detect_extension(ext: ExtensionDef) -> dict[str, Any]:
    """Single extension status for API."""
    manual = extension_preferences.get_extension_prefs(ext["id"])
    exes = [detect_executable(ext["id"], n, manual) for n in ext["detect"]]
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
        "has_manual_paths": bool(manual),
        "manual_paths": _manual_paths_for_api(ext["id"], manual, ext["detect"]),
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


def tex_toolchain_status() -> dict[str, Any]:
    """
    PDF 排版工具链检测（与 /api/system/tex-status 一致），包含手动指定路径。
    """
    manual = extension_preferences.get_extension_prefs("latex")
    latexmk = detect_executable("latex", "latexmk", manual)
    xelatex = detect_executable("latex", "xelatex", manual)
    winget_path = shutil.which("winget") if sys.platform == "win32" else None
    ready = bool(latexmk["on_path"] and xelatex["on_path"])
    return {
        "platform": sys.platform,
        "latexmk_on_path": latexmk["on_path"],
        "xelatex_on_path": xelatex["on_path"],
        "winget_on_path": winget_path is not None if sys.platform == "win32" else None,
        "pdf_engine_ready": ready,
    }


def validate_and_save_manual_path(
    ext_id: str,
    raw_path: str,
    *,
    location_kind: str,
) -> dict[str, Any]:
    """
    Validate user-chosen path and persist. location_kind: \"dir\" | \"file\".

    Returns {\"ok\": True, \"entry\": dict} or {\"ok\": False, \"message\": str}.
    """
    ext = next((e for e in EXTENSIONS if e["id"] == ext_id), None)
    if ext is None:
        return {"ok": False, "message": "未知的扩展标识。"}
    try:
        p = Path(raw_path.strip()).expanduser().resolve()
    except OSError as e:
        return {"ok": False, "message": f"路径无效：{e}"}

    if location_kind == "dir":
        if not p.is_dir():
            return {"ok": False, "message": "所选路径不是文件夹。"}
        if ext_id == "latex":
            mk = _exe_in_dir(p, "latexmk")
            xe = _exe_in_dir(p, "xelatex")
            if not mk or not xe:
                return {
                    "ok": False,
                    "message": "该文件夹中未同时找到排版所需的两个程序，请确认已选择正确的安装目录。",
                }
            entry = {"bin_dir": str(p)}
            extension_preferences.set_extension_prefs(ext_id, entry)
            return {"ok": True, "entry": entry}
        # Single-tool extension: find exe in folder
        if len(ext["detect"]) != 1:
            return {"ok": False, "message": "该扩展不支持仅选择文件夹。"}
        name = ext["detect"][0]
        hit = _exe_in_dir(p, name)
        if not hit:
            return {"ok": False, "message": "该文件夹中未找到对应程序。"}
        entry = {name: str(hit)}
        extension_preferences.set_extension_prefs(ext_id, entry)
        return {"ok": True, "entry": entry}

    # file
    if not p.is_file():
        return {"ok": False, "message": "所选路径不是可执行文件。"}
    if ext_id == "latex":
        base = p.name.lower()
        if "latexmk" in base:
            key = "latexmk"
        elif "xelatex" in base:
            key = "xelatex"
        else:
            return {"ok": False, "message": "请从排版组件安装目录中选择，或选择 latexmk / xelatex 可执行文件。"}
        entry = extension_preferences.get_extension_prefs("latex") or {}
        entry.pop("bin_dir", None)
        entry[key] = str(p)
        extension_preferences.set_extension_prefs("latex", entry)
        return {"ok": True, "entry": entry}

    if len(ext["detect"]) != 1:
        return {"ok": False, "message": "该扩展需要选择安装目录或分别指定可执行文件。"}
    name = ext["detect"][0]
    base_name = p.name.lower()
    if name.lower() not in base_name:
        return {"ok": False, "message": "所选文件与当前扩展不匹配。"}
    entry = {name: str(p)}
    extension_preferences.set_extension_prefs(ext_id, entry)
    return {"ok": True, "entry": entry}


def clear_manual_path(ext_id: str) -> dict[str, Any]:
    if not extension_preferences.clear_extension_prefs(ext_id):
        return {"ok": False, "message": "当前没有已保存的路径。"}
    return {"ok": True}


def _quote_for_cmd(value: str) -> str:
    """Quote a value for cmd.exe command strings."""
    return '"' + value.replace('"', '""') + '"'


def install_via_winget(winget_id: str, *, display_label: str = "") -> dict[str, Any]:
    """
    Start winget in a new console window so output/errors stay visible; the window waits for a key.

    Windows only."""
    if sys.platform != "win32":
        return {"ok": False, "message": "当前系统不支持此一键安装，请按页面说明手动安装。"}
    winget = shutil.which("winget")
    if not winget:
        return {
            "ok": False,
            "message": "未找到系统自带的应用安装器，请使用「手动下载」按官方说明安装。",
        }
    winget_abs = str(Path(winget).resolve())
    label = (display_label or winget_id).replace('"', "'")
    winget_id_for_cmd = _quote_for_cmd(winget_id)
    lines = [
        "@echo off",
        "chcp 65001 >nul",
        f'title 安装：{label}',
        f"echo 正在安装：{label}",
        "echo.",
        f'call "{winget_abs}" install {winget_id_for_cmd} --accept-source-agreements --accept-package-agreements',
        "echo.",
        "echo 命令已结束，退出代码：%ERRORLEVEL%",
        "echo.",
        "echo 请查看上方输出确认是否成功；完成后可回到本应用点击「重新检测」。",
        "pause",
        "",
    ]
    content = "\r\n".join(lines)
    fd, tmp_path = tempfile.mkstemp(suffix=".cmd", prefix="sol_edu_winget_")
    try:
        os.close(fd)
    except OSError:
        pass
    bat = Path(tmp_path)
    try:
        bat.write_text(content, encoding="utf-8-sig")
    except OSError as e:
        return {"ok": False, "message": f"无法写入临时安装脚本：{e}"}

    # 用单条命令字符串交给外层 cmd /c，避免 Windows 在 argv->命令行转换时破坏嵌套引号。
    # start 后必须跟带引号的窗口标题（常用空标题 `""`）。
    cmd_exe = os.environ.get("COMSPEC", "cmd.exe")
    bat_path = str(bat.resolve())
    cmd_for_cmd = _quote_for_cmd(cmd_exe)
    bat_for_cmd = _quote_for_cmd(bat_path)
    launch_command = f'{cmd_for_cmd} /c start "" {cmd_for_cmd} /c {bat_for_cmd}'
    try:
        subprocess.Popen(
            launch_command,
            close_fds=False,
        )
    except OSError as e:
        return {"ok": False, "message": f"无法启动安装流程：{e}"}
    return {
        "ok": True,
        "message": "已打开安装窗口，请在其中查看结果；完成后回到本页点击「重新检测」。",
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
    return install_via_winget(winget_id, display_label=ext["name"])
