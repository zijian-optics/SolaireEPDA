"""Tests for GET/PUT /api/agent/llm-settings (provider contract, persistence, masking)."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from solaire.agent_layer.llm.llm_overrides import overrides_file


def test_llm_settings_get_includes_provider_and_options(web_client: TestClient) -> None:
    r = web_client.get("/api/agent/llm-settings")
    assert r.status_code == 200
    data = r.json()
    assert "provider" in data
    assert data["provider"] in {"openai", "anthropic", "openai_compat", "deepseek"}
    assert data.get("reasoning_effort") in ("high", "max")
    opts = data.get("provider_options")
    assert isinstance(opts, list)
    ids = {o["id"] for o in opts}
    assert ids == {"openai", "anthropic", "openai_compat", "deepseek"}
    assert "api_key" not in data


def test_llm_settings_put_reasoning_effort_persists(web_client: TestClient, tmp_path: Path) -> None:
    r = web_client.put("/api/agent/llm-settings", json={"reasoning_effort": "max"})
    assert r.status_code == 200
    path = overrides_file(tmp_path)
    assert path.is_file()
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["reasoning_effort"] == "max"
    r2 = web_client.get("/api/agent/llm-settings")
    assert r2.status_code == 200
    assert r2.json().get("reasoning_effort") == "max"


def test_llm_settings_put_invalid_reasoning_effort_400(web_client: TestClient) -> None:
    r = web_client.put("/api/agent/llm-settings", json={"reasoning_effort": "bogus"})
    assert r.status_code == 400


def test_llm_settings_put_provider_persists_to_project(web_client: TestClient, tmp_path: Path) -> None:
    r = web_client.put(
        "/api/agent/llm-settings",
        json={"provider": "deepseek", "main_model": "deepseek-v4-pro", "fast_model": "deepseek-v4-flash"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    path = overrides_file(tmp_path)
    assert path.is_file()
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["provider"] == "deepseek"
    assert raw["main_model"] == "deepseek-v4-pro"
    assert raw["fast_model"] == "deepseek-v4-flash"

    r2 = web_client.get("/api/agent/llm-settings")
    assert r2.status_code == 200
    assert r2.json()["provider"] == "deepseek"
    assert r2.json()["main_model"] == "deepseek-v4-pro"


def test_llm_settings_put_api_key_masked_in_get(web_client: TestClient) -> None:
    r = web_client.put("/api/agent/llm-settings", json={"api_key": "sk-test-key-abcdef"})
    assert r.status_code == 200
    r2 = web_client.get("/api/agent/llm-settings")
    assert r2.status_code == 200
    body = r2.json()
    assert body["llm_configured"] is True
    assert body.get("api_key_masked") == "********cdef"
    assert "api_key" not in body


def test_llm_settings_put_invalid_provider_400(web_client: TestClient) -> None:
    r = web_client.put("/api/agent/llm-settings", json={"provider": "not-a-provider"})
    assert r.status_code == 400


def test_agent_config_includes_provider(web_client: TestClient) -> None:
    web_client.put("/api/agent/llm-settings", json={"provider": "openai", "reasoning_effort": "max"})
    r = web_client.get("/api/agent/config")
    assert r.status_code == 200
    body = r.json()
    assert body.get("provider") == "openai"
    assert body.get("reasoning_effort") == "max"
