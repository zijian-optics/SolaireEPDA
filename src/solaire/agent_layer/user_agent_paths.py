"""Per-user SolEdu app state directory (not bound to a course project)."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def user_config_root() -> Path:
    """Root folder for app-wide settings (OS profile / XDG)."""
    override = os.environ.get("SOLAIRE_USER_CONFIG_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA", "").strip()
        if appdata:
            return (Path(appdata) / "SolEdu").resolve()
        return (Path.home() / "SolEdu").resolve()
    if sys.platform == "darwin":
        return (Path.home() / "Library" / "Application Support" / "SolEdu").resolve()
    xdg = os.environ.get("XDG_CONFIG_HOME", "").strip()
    if xdg:
        return (Path(xdg).expanduser() / "solaire").resolve()
    return (Path.home() / ".config" / "solaire").expanduser().resolve()


def user_agent_state_dir() -> Path:
    return user_config_root() / "agent"
