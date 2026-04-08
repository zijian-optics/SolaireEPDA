"""Tests for /api/system/extensions and install route."""

from __future__ import annotations

import sys

import pytest
from fastapi.testclient import TestClient

from solaire.web.app import app


def test_extensions_list_returns_items() -> None:
    client = TestClient(app)
    r = client.get("/api/system/extensions")
    assert r.status_code == 200
    data = r.json()
    assert "extensions" in data
    assert isinstance(data["extensions"], list)
    ids = {e["id"] for e in data["extensions"]}
    assert ids == {"latex", "pandoc", "tesseract", "mmdr"}
    for ext in data["extensions"]:
        assert "name" in ext
        assert "description" in ext
        assert "ready" in ext
        assert "can_auto_install" in ext
        assert "executables" in ext
        assert isinstance(ext["executables"], list)


@pytest.mark.skipif(sys.platform != "win32", reason="winget install is Windows-only")
def test_extension_install_calls_winget_for_pandoc(monkeypatch: pytest.MonkeyPatch) -> None:
    called: dict[str, object] = {}

    class DummyPopen:
        def __init__(self, *args: object, **kwargs: object) -> None:
            called["args"] = args

    monkeypatch.setattr("solaire.web.extension_registry.shutil.which", lambda x: "C:\\winget.exe" if x == "winget" else None)
    monkeypatch.setattr("solaire.web.extension_registry.subprocess.Popen", DummyPopen)

    client = TestClient(app)
    r = client.post("/api/system/extensions/pandoc/install")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert "args" in called


def test_extension_install_unknown_id() -> None:
    client = TestClient(app)
    r = client.post("/api/system/extensions/not-a-real-id/install")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is False


def test_extension_install_mmdr_no_winget() -> None:
    client = TestClient(app)
    r = client.post("/api/system/extensions/mmdr/install")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is False
