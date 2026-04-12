"""User-wide LLM overrides vs project merge (no live LLM)."""

from __future__ import annotations

from pathlib import Path

import pytest

from solaire.agent_layer.guardrails import (
    SAFETY_MODE_MODERATO,
    SAFETY_MODE_PRESTISSIMO,
    load_safety_mode,
    save_safety_mode,
    save_user_safety_mode,
)
from solaire.agent_layer.llm.llm_overrides import load_overrides_raw, save_overrides_raw
from solaire.agent_layer.llm.router import load_llm_settings
from solaire.agent_layer.llm.user_llm_overrides import load_user_overrides_raw, save_user_overrides_raw


def test_load_llm_settings_user_then_project_priority(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    udir = tmp_path / "profile"
    monkeypatch.setenv("SOLAIRE_USER_CONFIG_DIR", str(udir))
    save_user_overrides_raw({"main_model": "from-user", "api_key": "sk-user"})
    save_overrides_raw(tmp_path, {"main_model": "from-project", "api_key": "sk-proj"})

    s = load_llm_settings(tmp_path)
    assert s.main_model == "from-project"
    assert s.api_key == "sk-proj"

    s2 = load_llm_settings(None)
    assert s2.main_model == "from-user"
    assert s2.api_key == "sk-user"


def test_load_llm_settings_user_only_when_no_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOLAIRE_USER_CONFIG_DIR", str(tmp_path / "p"))
    save_user_overrides_raw({"main_model": "u-only", "fast_model": "u-fast"})

    s = load_llm_settings(None)
    assert s.main_model == "u-only"
    assert s.fast_model == "u-fast"


def test_load_safety_mode_user_overridden_by_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOLAIRE_USER_CONFIG_DIR", str(tmp_path / "prof"))
    save_user_safety_mode(SAFETY_MODE_PRESTISSIMO)
    save_safety_mode(tmp_path, SAFETY_MODE_MODERATO)

    assert load_safety_mode(tmp_path) == SAFETY_MODE_MODERATO
    assert load_safety_mode(None) == SAFETY_MODE_PRESTISSIMO


def test_load_user_overrides_raw_empty_without_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOLAIRE_USER_CONFIG_DIR", str(tmp_path / "empty"))
    assert load_user_overrides_raw() == {}


def test_project_raw_unchanged_by_user_module(tmp_path: Path) -> None:
    save_overrides_raw(tmp_path, {"main_model": "p"})
    assert load_overrides_raw(tmp_path)["main_model"] == "p"
