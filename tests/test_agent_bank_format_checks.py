from __future__ import annotations

from pathlib import Path

from solaire.agent_layer.models import InvocationContext, SessionState
from solaire.agent_layer.registry import invoke_registered_tool
from solaire.web.project_layout import ensure_project_layout


def _ctx(root: Path) -> InvocationContext:
    ensure_project_layout(root)
    return InvocationContext(
        project_root=root,
        session_id="s1",
        session=SessionState(session_id="s1"),
        mode="execute",
    )


def test_bank_create_item_returns_format_warnings(tmp_path: Path) -> None:
    tr = invoke_registered_tool(
        "bank.create_item",
        {
            "collection_namespace": "math/unit1",
            "question_id": "q1",
            "question_type": "fill",
            "content": "Fill ______.",
            "answer": "1",
        },
        _ctx(tmp_path),
    )

    assert tr.status == "succeeded"
    assert tr.data["qualified_id"] == "math/unit1/q1"
    assert tr.data["format_ok"] is False
    assert tr.data["format_warning_count"] >= 1
    assert any(w["code"] == "latex_underscore" for w in tr.data["format_warnings"])
    assert tr.data["next_action"]
    assert tr.summary_for_llm and "latex_underscore" in tr.summary_for_llm


def test_bank_update_item_returns_format_warnings_after_save(tmp_path: Path) -> None:
    ctx = _ctx(tmp_path)
    created = invoke_registered_tool(
        "bank.create_item",
        {
            "collection_namespace": "math/unit1",
            "question_id": "q1",
            "question_type": "fill",
            "content": r"Let $x_1$ satisfy the condition.",
            "answer": "1",
        },
        ctx,
    )
    assert created.status == "succeeded"
    assert created.data["format_ok"] is True

    updated = invoke_registered_tool(
        "bank.update_item",
        {
            "qualified_id": "math/unit1/q1",
            "content": "Broken blank ______.",
        },
        ctx,
    )

    assert updated.status == "succeeded"
    assert updated.data["format_ok"] is False
    assert updated.data["updated_fields"] == ["content"]
    assert any(w["field"] == "content" and w["code"] == "latex_underscore" for w in updated.data["format_warnings"])
