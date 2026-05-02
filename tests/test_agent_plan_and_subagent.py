"""Agent plan validation, subagent tool policy, lightweight orchestration checks."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from solaire.agent_layer.models import ChatMessage, InvocationContext, PendingConfirmation, SessionState
from solaire.agent_layer.orchestrator import run_agent_turn
from solaire.agent_layer.registry import SUBAGENT_EXCLUDED_NAMES, tools_for_subagent
from solaire.agent_layer.tools import session_tools
from solaire.agent_layer.cancel_signal import request_cancel


def test_tools_for_subagent_excludes_session_mutators() -> None:
    names = {t.name for t in tools_for_subagent(allowed_prefixes=None)}
    for n in SUBAGENT_EXCLUDED_NAMES:
        assert n not in names


def test_exit_plan_mode_requires_valid_plan_file(tmp_path: Path) -> None:
    sess = SessionState(session_id="s1", plan_mode_active=True)
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=sess)

    tr = session_tools.tool_exit_plan_mode(ctx, {"plan_file_path": ""})
    assert tr.status == "failed"

    tr2 = session_tools.tool_exit_plan_mode(
        ctx, {"plan_file_path": ".solaire/agent/plans/missing.md"}
    )
    assert tr2.status == "failed"

    rel = ".solaire/agent/plans/bad.md"
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("---\nname: n\noverview: o\n---\n\n", encoding="utf-8")
    tr3 = session_tools.tool_exit_plan_mode(ctx, {"plan_file_path": rel})
    assert tr3.status == "failed"
    assert "todos" in (tr3.error_message or "")


def test_run_agent_turn_rejects_execution_without_pending_plan(tmp_path: Path) -> None:
    session = SessionState(session_id="sid")
    events: list[tuple[str, dict]] = []

    async def emit(ev: str, data: dict) -> None:
        events.append((ev, data))

    rel = ".solaire/agent/plans/x.md"
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        "---\nname: n\noverview: o\ntodos:\n  - id: a\n    content: c\n    status: pending\n---\n\n## b\n",
        encoding="utf-8",
    )

    router = MagicMock()
    router.main.return_value = MagicMock()
    router.fast.return_value = MagicMock()

    async def _run() -> None:
        await run_agent_turn(
            tmp_path,
            session,
            user_message="hi",
            project_ctx={"_execution_plan_path": rel},
            router=router,
            emit=emit,
            max_llm_rounds=1,
        )

    asyncio.run(_run())

    assert any(e[0] == "error" and e[1].get("code") == "plan_not_approved" for e in events)


def test_run_agent_turn_emits_done_after_confirm_needed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """工具循环在需确认时应结束流，避免前端一直等待。"""
    session = SessionState(session_id="sid2")
    session.messages.append(ChatMessage(role="user", content="do write"))
    session.draft_assistant = {
        "content": None,
        "reasoning_content": "",
        "tool_calls": [
            {
                "id": "c1",
                "function": {"name": "file.write", "arguments": "{}"},
            }
        ],
    }
    session.draft_tool_results = []

    events: list[tuple[str, dict]] = []

    async def emit(ev: str, data: dict) -> None:
        events.append((ev, data))

    from solaire.agent_layer import orchestrator as orch_mod

    async def fake_draft_loop(**kwargs):
        from solaire.agent_layer.session import save_session

        dtc = kwargs["dtc"]
        sess = dtc.session
        sess.pending_confirmations["aid"] = PendingConfirmation(
            tool_call_id="c1",
            tool_name="file.write",
            arguments={},
            description="test",
        )
        await dtc.emit(
            "confirm_needed",
            {"action_id": "aid", "tool_name": "file.write", "description": "x", "risk": "w"},
        )
        save_session(dtc.project_root, sess)
        await dtc.emit("done", {"usage": {}, "awaiting_confirmation": True})
        return True

    monkeypatch.setattr(orch_mod, "run_draft_tool_loop", fake_draft_loop)

    router = MagicMock()
    adapter = MagicMock()
    router.main.return_value = adapter
    router.fast.return_value = adapter

    async def _run() -> None:
        await run_agent_turn(
            tmp_path,
            session,
            user_message=None,
            project_ctx={},
            router=router,
            emit=emit,
            max_llm_rounds=1,
        )

    asyncio.run(_run())

    assert any(e[0] == "done" and e[1].get("awaiting_confirmation") for e in events)


def test_run_agent_turn_emits_repeat_loop_when_identical_tool_calls_repeat(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    session = SessionState(session_id="sid3")
    events: list[tuple[str, dict]] = []

    async def emit(ev: str, data: dict) -> None:
        events.append((ev, data))

    from solaire.agent_layer import orchestrator as orch_mod

    async def fake_llm_round_call(*args, **kwargs):
        return (
            "",
            [{"id": "c1", "function": {"name": "memory.read_index", "arguments": "{}"}}],
            {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "",
            "stop",
        )

    async def fake_draft_loop(**kwargs):
        return False

    monkeypatch.setattr(orch_mod, "_llm_round_call", fake_llm_round_call)
    monkeypatch.setattr(orch_mod, "run_draft_tool_loop", fake_draft_loop)

    router = MagicMock()
    adapter = MagicMock()
    router.main.return_value = adapter
    router.fast.return_value = adapter

    async def _run() -> None:
        await run_agent_turn(
            tmp_path,
            session,
            user_message="请继续",
            project_ctx={},
            router=router,
            emit=emit,
            max_llm_rounds=2,
        )

    asyncio.run(_run())

    assert any(e[0] == "error" and e[1].get("code") == "repeat_loop" for e in events)
    assert any(e[0] == "done" for e in events)
    assert session.messages and session.messages[-1].role == "assistant"
    assert "重复" in (session.messages[-1].content or "")


def test_run_agent_turn_cancelled_emits_error_and_done(tmp_path: Path) -> None:
    session = SessionState(session_id="sid4")
    events: list[tuple[str, dict]] = []

    async def emit(ev: str, data: dict) -> None:
        events.append((ev, data))

    request_cancel(session.session_id)

    router = MagicMock()
    router.main.return_value = MagicMock()
    router.fast.return_value = MagicMock()

    async def _run() -> None:
        await run_agent_turn(
            tmp_path,
            session,
            user_message="停止",
            project_ctx={},
            router=router,
            emit=emit,
            max_llm_rounds=1,
        )

    asyncio.run(_run())

    assert any(e[0] == "error" and e[1].get("code") == "cancelled" for e in events)
    assert any(e[0] == "done" and e[1].get("cancelled") is True for e in events)


def test_run_agent_turn_emits_tool_schema_hash_in_context_metrics(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    session = SessionState(session_id="sid5")
    events: list[tuple[str, dict]] = []

    async def emit(ev: str, data: dict) -> None:
        events.append((ev, data))

    from solaire.agent_layer import orchestrator as orch_mod

    async def fake_llm_round_call(*args, **kwargs):
        return (
            "已完成",
            [],
            {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "",
            "stop",
        )

    monkeypatch.setattr(orch_mod, "_llm_round_call", fake_llm_round_call)

    router = MagicMock()
    adapter = MagicMock()
    router.main.return_value = adapter
    router.fast.return_value = adapter

    async def _run() -> None:
        await run_agent_turn(
            tmp_path,
            session,
            user_message="你好",
            project_ctx={},
            router=router,
            emit=emit,
            max_llm_rounds=1,
        )

    asyncio.run(_run())

    metrics = [data for ev, data in events if ev == "context_metrics"]
    assert metrics
    latest = metrics[-1]
    assert isinstance(latest.get("tool_schema_sha12"), str)
    assert len(latest["tool_schema_sha12"]) == 12
    assert isinstance(latest.get("tool_count"), int)
