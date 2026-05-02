"""GET /api/agent/sessions/{id}/context-meter — 与落盘会话一致的用量估算。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from solaire.agent_layer.models import ChatMessage, SessionState
from solaire.agent_layer.session import save_session


def test_context_meter_returns_est_for_session(web_client: TestClient, tmp_path) -> None:
    root = tmp_path
    sid = "a" * 32
    s = SessionState(session_id=sid, messages=[ChatMessage(role="user", content="hello meter")])
    save_session(root, s)

    r = web_client.get(f"/api/agent/sessions/{sid}/context-meter")
    assert r.status_code == 200
    body = r.json()
    assert "context_tokens_est" in body
    assert isinstance(body["context_tokens_est"], int)
    assert body["context_tokens_est"] > 0


def test_context_meter_404_unknown_session(web_client: TestClient) -> None:
    r = web_client.get("/api/agent/sessions/" + "b" * 32 + "/context-meter")
    assert r.status_code == 404
