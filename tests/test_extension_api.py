"""Tests for /api/system/extensions and install route."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from solaire.web.app import app


@pytest.fixture(autouse=True)
def _isolated_extension_prefs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Do not write host_extension_paths.json into the real %APPDATA% during tests."""
    monkeypatch.setattr("solaire.web.extension_preferences.app_data_dir", lambda: tmp_path)


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
        assert "has_manual_paths" in ext
        assert "manual_paths" in ext
        for exe in ext["executables"]:
            assert "resolved_from" in exe


@pytest.mark.skipif(sys.platform != "win32", reason="winget install is Windows-only")
def test_extension_install_calls_winget_for_pandoc(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    called: dict[str, object] = {}
    script_dir = tmp_path / "Temp Folder"
    script_dir.mkdir()
    script_path = script_dir / "sol edu install.cmd"

    class DummyPopen:
        def __init__(self, *args: object, **kwargs: object) -> None:
            called["args"] = args
            called["kwargs"] = kwargs

    cmd_exe = r"C:\Windows\System32\cmd.exe"
    monkeypatch.setenv("COMSPEC", cmd_exe)
    monkeypatch.setattr("solaire.web.extension_registry.shutil.which", lambda x: "C:\\winget.exe" if x == "winget" else None)
    monkeypatch.setattr("solaire.web.extension_registry.tempfile.mkstemp", lambda **_: (123, str(script_path)))
    monkeypatch.setattr("solaire.web.extension_registry.os.close", lambda _: None)
    monkeypatch.setattr("solaire.web.extension_registry.subprocess.Popen", DummyPopen)

    client = TestClient(app)
    r = client.post("/api/system/extensions/pandoc/install")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert "args" in called
    assert called["kwargs"] == {"close_fds": False}

    launch_command = called["args"][0]
    assert isinstance(launch_command, str)

    expected_script = '"' + str(script_path.resolve()).replace('"', '""') + '"'
    expected_cmd = '"' + cmd_exe.replace('"', '""') + '"'
    assert launch_command == f'{expected_cmd} /c start "" {expected_cmd} /c {expected_script}'

    script_body = script_path.read_text(encoding="utf-8-sig")
    assert 'call "C:\\winget.exe" install "JohnMacFarlane.Pandoc"' in script_body
    assert "pause" in script_body


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


def test_manual_path_latex_dir(tmp_path: Path) -> None:
    d = tmp_path / "bin"
    d.mkdir()
    (d / "latexmk.exe").write_bytes(b"")
    (d / "xelatex.exe").write_bytes(b"")
    client = TestClient(app)
    r = client.put(
        "/api/system/extensions/latex/manual-path",
        json={"path": str(d), "location_kind": "dir"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    latex = next(e for e in body["extensions"] if e["id"] == "latex")
    assert latex.get("has_manual_paths") is True


def test_manual_path_clear_unknown_returns_400() -> None:
    client = TestClient(app)
    r = client.delete("/api/system/extensions/latex/manual-path")
    assert r.status_code == 400


def test_tex_status_matches_latex_extension() -> None:
    """PDF 排版检测与扩展列表中的 latex 项同源。"""
    client = TestClient(app)
    tex = client.get("/api/system/tex-status").json()
    exts = client.get("/api/system/extensions").json()["extensions"]
    latex = next(e for e in exts if e["id"] == "latex")
    assert tex["latexmk_on_path"] == latex["executables"][0]["on_path"]
    assert tex["xelatex_on_path"] == latex["executables"][1]["on_path"]
    assert tex["pdf_engine_ready"] == latex["ready"]
