from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from solaire.web import state
from solaire.web.project_layout import ensure_project_layout


def test_api_questions_returns_metadata_for_standalone_and_empty_for_groups(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from solaire.web.app import app

    root = tmp_path.resolve()
    ensure_project_layout(root)
    lib = root / "resource" / "math" / "bank"
    lib.mkdir(parents=True)
    (lib / "q1.yaml").write_text(
        """
id: q1
type: short_answer
content: Test stem
answer: Test answer
analysis: Test analysis
metadata:
  difficulty: high
  source: mock
  novelty: 0.3
""".lstrip(),
        encoding="utf-8",
    )
    (lib / "g1.yaml").write_text(
        """
id: g1
type: group
material: Shared material
unified: fill
items:
  - content: Sub stem
    answer: Sub answer
    metadata:
      difficulty: low
""".lstrip(),
        encoding="utf-8",
    )

    monkeypatch.setattr(state, "get_root", lambda: root)
    client = TestClient(app)
    response = client.get("/api/questions")

    assert response.status_code == 200
    by_id = {item["qualified_id"]: item for item in response.json()["questions"]}
    assert by_id["math/bank/q1"]["metadata"] == {
        "difficulty": "high",
        "source": "mock",
        "novelty": 0.3,
    }
    assert by_id["math/bank/g1"]["metadata"] == {}