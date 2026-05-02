"""Tests for M3 agent_layer registry, memory, guardrails (no live LLM)."""

from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path
from typing import Any

import pytest

from solaire.agent_layer.history_writer import emit_memory_after_assistant_turn
from solaire.agent_layer.guardrails import (
    GuardrailDecision,
    SAFETY_MODE_ALLEGRO,
    SAFETY_MODE_PRESTISSIMO,
    SAFETY_MODE_VIVACE,
    check_tool_call,
    save_safety_mode,
    vivace_needs_fast_model_review,
)
from solaire.agent_layer.memory import (
    ensure_memory_layout,
    list_topic_filenames,
    merge_index_bullet,
    read_index,
    read_topic,
    write_index,
    write_topic,
)
from solaire.agent_layer.models import InvocationContext, SessionState
from solaire.agent_layer.plan_document import load_plan_steps_from_rel_path, steps_from_plan_body
from solaire.agent_layer.registry import invoke_registered_tool, openai_tools_payload, select_tools_for_turn
from solaire.agent_layer.tool_executor import consecutive_subtask_tool_indices
from solaire.agent_layer.tools import file_tools
from solaire.agent_layer.llm.providers import ReasoningEffort


def test_doc_ocr_image_uses_saved_tesseract_path(tmp_path: Path, monkeypatch) -> None:
    img_rel = "images/sample.png"
    img_path = tmp_path / img_rel
    img_path.parent.mkdir(parents=True, exist_ok=True)
    img_path.write_bytes(b"fake-image")
    exe_path = tmp_path / "tools" / "tesseract.exe"
    exe_path.parent.mkdir(parents=True, exist_ok=True)
    exe_path.write_bytes(b"")

    pil_module = types.ModuleType("PIL")

    class _ImageModule:
        @staticmethod
        def open(path: str) -> str:
            return path

    pil_module.Image = _ImageModule

    fake_inner = types.SimpleNamespace(tesseract_cmd=None)
    called: dict[str, object] = {}
    pytesseract_module = types.ModuleType("pytesseract")
    pytesseract_module.pytesseract = fake_inner

    def _image_to_string(img: object, lang: str) -> str:
        called["img"] = img
        called["lang"] = lang
        called["tesseract_cmd"] = fake_inner.tesseract_cmd
        return "识别结果"

    pytesseract_module.image_to_string = _image_to_string

    monkeypatch.setitem(sys.modules, "PIL", pil_module)
    monkeypatch.setitem(sys.modules, "pytesseract", pytesseract_module)
    monkeypatch.setattr(
        "solaire.web.extension_preferences.get_extension_prefs",
        lambda ext_id: {"path": str(exe_path)} if ext_id == "tesseract" else None,
    )

    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool("doc.ocr_image", {"path": img_rel, "lang": "chi_sim"}, ctx)

    assert tr.status == "succeeded"
    assert tr.data["content"] == "识别结果"
    assert called["lang"] == "chi_sim"
    assert called["tesseract_cmd"] == str(exe_path.resolve())


def test_openai_tools_payload_contains_analysis_and_memory():
    tools = openai_tools_payload()
    names = {t["function"]["name"] for t in tools}
    assert "analysis.list_datasets" in names
    assert "memory.read_index" in names
    assert "agent.set_task_plan" in names
    assert "agent.run_subtask" in names
    assert "graph.search_nodes" in names
    assert "graph.batch_bind_questions" in names
    assert "web.search" in names
    assert "agent.run_tool_pipeline" in names
    assert "agent.read_skill_reference" in names


def test_read_skill_reference_builtin_primebrush(tmp_path: Path) -> None:
    """技能 references 不在教师项目内，须通过专用工具从技能包读取。"""
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool(
        "agent.read_skill_reference",
        {"name": "primebrush_diagrams", "path": "references/geometry-2d.md"},
        ctx,
    )
    assert tr.status == "succeeded"
    content = tr.data.get("content", "")
    assert "geometry_2d" in content


def test_read_skill_reference_rejects_path_traversal(tmp_path: Path) -> None:
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool(
        "agent.read_skill_reference",
        {"name": "primebrush_diagrams", "path": "references/../../../pyproject.toml"},
        ctx,
    )
    assert tr.status == "failed"


def test_invoke_list_datasets(tmp_path: Path) -> None:
    # No result port configured in isolated tmp project — expect failure or empty
    from solaire.edu_analysis.ports import configure as configure_edu
    from solaire.web.result_service import ResultServiceAdapter

    configure_edu(result_port=ResultServiceAdapter())
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool("analysis.list_datasets", {}, ctx)
    assert tr.status == "succeeded"
    assert "datasets" in tr.data


def test_memory_layout(tmp_path: Path) -> None:
    ensure_memory_layout(tmp_path)
    idx = read_index(tmp_path)
    assert "记忆索引" in idx
    write_topic(tmp_path, "analysis_history.md", "- test line\n")
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool("memory.read_topic", {"topic": "analysis_history.md"}, ctx)
    assert tr.status == "succeeded"
    assert "test line" in tr.data.get("content", "")


def test_merge_index_self_heal(tmp_path: Path) -> None:
    ensure_memory_layout(tmp_path)
    write_index(tmp_path, "## 记忆索引\n- [分析记录](analysis_history.md): 月考薄弱点为函数\n")
    assert merge_index_bullet(
        tmp_path,
        "[分析记录](analysis_history.md): 月考薄弱点为函数与几何综合题",
        overlap_threshold=0.55,
    )
    idx = read_index(tmp_path)
    assert "几何" in idx
    assert idx.count("[分析记录]") <= 1


def test_merge_index_strict_threshold_appends(tmp_path: Path) -> None:
    """高阈值时相近但不完全重叠的条目保留为两行，降低误替换。"""
    ensure_memory_layout(tmp_path)
    write_index(tmp_path, "## 记忆索引\n- [分析记录](analysis_history.md): 月考薄弱点为函数\n")
    assert merge_index_bullet(
        tmp_path,
        "[分析记录](analysis_history.md): 月考薄弱点为函数与几何综合题",
        overlap_threshold=0.92,
    )
    idx = read_index(tmp_path)
    assert idx.count("[分析记录]") == 2


def test_list_topics_after_write(tmp_path: Path) -> None:
    ensure_memory_layout(tmp_path)
    write_topic(tmp_path, "note_a.md", "hello")
    names = list_topic_filenames(tmp_path)
    assert "note_a.md" in names


def test_agent_task_plan_tools(tmp_path: Path) -> None:
    sess = SessionState(session_id="t1")
    ctx = InvocationContext(project_root=tmp_path, session_id="t1", session=sess)
    tr = invoke_registered_tool(
        "agent.set_task_plan",
        {"steps": [{"title": "查数据", "status": "pending"}, {"title": "写结论", "status": "pending"}]},
        ctx,
    )
    assert tr.status == "succeeded"
    assert len(sess.task_plan) == 2
    tr2 = invoke_registered_tool("agent.update_task_step", {"index": 0, "status": "done"}, ctx)
    assert tr2.status == "succeeded"
    assert sess.task_plan[0]["status"] == "done"


def test_graph_search_nodes_empty_project(tmp_path: Path) -> None:
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool("graph.search_nodes", {"query": "测试"}, ctx)
    assert tr.status == "succeeded"
    assert "nodes" in tr.data


def test_guardrail_read_vs_export(tmp_path: Path) -> None:
    sess = SessionState(session_id="x")
    ctx = InvocationContext(project_root=tmp_path, session_id="x", session=sess, mode="execute")
    mode = SAFETY_MODE_ALLEGRO
    assert check_tool_call("analysis.list_datasets", {}, ctx, safety_mode=mode) == GuardrailDecision.AUTO_APPROVE
    assert check_tool_call("exam.export_paper", {}, ctx, safety_mode=mode) == GuardrailDecision.NEEDS_CONFIRMATION


@pytest.mark.parametrize("effort", ("high", "max"))
def test_openai_compat_deepseek_adds_thinking_extra_body(
    effort: ReasoningEffort, monkeypatch: pytest.MonkeyPatch
) -> None:
    """DeepSeek OpenAI 兼容须在请求中带 thinking（见官方思考模式说明）。"""
    from solaire.agent_layer.llm.openai_compat import OpenAICompatAdapter

    captured: dict[str, Any] = {}

    class FakeMsg:
        content = "ok"
        tool_calls = None

    class FakeChoice:
        message = FakeMsg()
        finish_reason = "stop"

    class FakeResp:
        choices = [FakeChoice()]
        usage = None

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return FakeResp()

    adapter = OpenAICompatAdapter(
        api_key="k",
        base_url="https://api.deepseek.com",
        model="deepseek-v4-pro",
        deepseek_compat=True,
        reasoning_effort=effort,
    )
    monkeypatch.setattr(adapter._client.chat.completions, "create", fake_create)
    tool = {
        "type": "function",
        "function": {"name": "get_date", "description": "d", "parameters": {"type": "object", "properties": {}}},
    }

    async def _run() -> None:
        await adapter.chat([{"role": "user", "content": "hi"}], tools=[tool])

    asyncio.run(_run())
    assert captured.get("extra_body", {}).get("thinking") == {"type": "enabled"}
    assert captured.get("reasoning_effort") == effort
    assert "parallel_tool_calls" not in captured


def test_openai_compat_deepseek_rewrites_dotted_tool_names(monkeypatch: pytest.MonkeyPatch) -> None:
    """DeepSeek 拒绝 tools[].function.name 含 '.'；出站改为下划线，入站还原。"""
    from solaire.agent_layer.llm.openai_compat import OpenAICompatAdapter
    from solaire.agent_layer.registry import all_registered_tools, openai_tools_payload

    rt = next(t for t in all_registered_tools() if t.name == "analysis.list_datasets")
    tools = openai_tools_payload([rt])
    captured: dict[str, Any] = {}

    class FakeFn:
        name = "analysis_list_datasets"
        arguments = "{}"

    class FakeTC:
        id = "call_x"
        function = FakeFn()

    class FakeMsg:
        content = "ok"
        tool_calls = [FakeTC()]

    class FakeChoice:
        message = FakeMsg()
        finish_reason = "tool_calls"

    class FakeResp:
        choices = [FakeChoice()]
        usage = None

    async def fake_create(**kwargs: Any) -> Any:
        captured.clear()
        captured.update(kwargs)
        return FakeResp()

    adapter = OpenAICompatAdapter(
        api_key="k",
        base_url="https://api.deepseek.com",
        model="deepseek-v4-pro",
        deepseek_compat=True,
    )
    monkeypatch.setattr(adapter._client.chat.completions, "create", fake_create)

    async def _run_out() -> None:
        await adapter.chat([{"role": "user", "content": "hi"}], tools=tools)

    asyncio.run(_run_out())
    assert captured["tools"][0]["function"]["name"] == "analysis_list_datasets"

    async def _run_in() -> None:
        resp = await adapter.chat([{"role": "user", "content": "hi"}], tools=tools)
        assert resp.tool_calls and resp.tool_calls[0]["function"]["name"] == "analysis.list_datasets"

    asyncio.run(_run_in())
 

def test_openai_compat_deepseek_extra_body_preserves_reasoning_in_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    """DeepSeek 思考模式：SDK 会裁掉 messages 里的 reasoning_content，须经 extra_body 覆盖。"""
    from solaire.agent_layer.llm.openai_compat import OpenAICompatAdapter

    captured: dict[str, Any] = {}

    class FakeMsg:
        content = "ok"
        tool_calls = None

    class FakeChoice:
        message = FakeMsg()
        finish_reason = "stop"

    class FakeResp:
        choices = [FakeChoice()]
        usage = None

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return FakeResp()

    adapter = OpenAICompatAdapter(
        api_key="k",
        base_url="https://api.deepseek.com",
        model="deepseek-v4-pro",
        deepseek_compat=True,
    )
    monkeypatch.setattr(adapter._client.chat.completions, "create", fake_create)
    tool = {
        "type": "function",
        "function": {"name": "get_date", "description": "d", "parameters": {"type": "object", "properties": {}}},
    }
    msgs = [
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "content": "call tool",
            "reasoning_content": "上一轮流式思维链须随历史回传",
            "tool_calls": [
                {
                    "id": "c1",
                    "type": "function",
                    "function": {"name": "get_date", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "{}"},
    ]

    async def _run() -> None:
        await adapter.chat(msgs, tools=[tool])

    asyncio.run(_run())
    eb = captured.get("extra_body") or {}
    assert eb.get("thinking") == {"type": "enabled"}
    roundtrip = eb.get("messages") or []
    assert len(roundtrip) >= 2
    assert roundtrip[1].get("reasoning_content") == "上一轮流式思维链须随历史回传"


def test_drop_oldest_history_removes_assistant_and_tools_together() -> None:
    from solaire.agent_layer.context import _drop_oldest_history_segment

    msgs = [
        {"role": "system", "content": "s"},
        {"role": "user", "content": "u1"},
        {
            "role": "assistant",
            "content": "a",
            "tool_calls": [{"id": "1", "type": "function", "function": {"name": "f", "arguments": "{}"}}],
        },
        {"role": "tool", "tool_call_id": "1", "content": "{}"},
        {"role": "user", "content": "u2"},
    ]
    assert _drop_oldest_history_segment(msgs, prefix_len=1) is True
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user" and msgs[1]["content"] == "u2"


def test_sanitize_tool_chains_drops_orphan_tool_after_system() -> None:
    from solaire.agent_layer.context import _sanitize_tool_chains

    msgs = [
        {"role": "system", "content": "s"},
        {"role": "tool", "tool_call_id": "x", "content": "{}"},
        {"role": "user", "content": "u"},
    ]
    _sanitize_tool_chains(msgs, start=1)
    assert msgs == [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]


def test_prepare_compat_wires_tool_message_name() -> None:
    from solaire.agent_layer.llm.openai_compat import _prepare_compat_request_payload

    msgs = [
        {"role": "tool", "tool_call_id": "c1", "content": "{}", "name": "agent.enter_plan_mode"},
        {
            "role": "assistant",
            "content": "x",
            "reasoning_content": "r",
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "agent.enter_plan_mode", "arguments": "{}"}}
            ],
        },
    ]
    m2, _ = _prepare_compat_request_payload(msgs, None)
    assert m2[0]["name"] == "agent_enter_plan_mode"
    assert m2[1]["tool_calls"][0]["function"]["name"] == "agent_enter_plan_mode"


def test_openai_compat_generic_parallel_tool_calls_with_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    from solaire.agent_layer.llm.openai_compat import OpenAICompatAdapter

    captured: dict[str, Any] = {}

    class FakeMsg:
        content = "ok"
        tool_calls = None

    class FakeChoice:
        message = FakeMsg()
        finish_reason = "stop"

    class FakeResp:
        choices = [FakeChoice()]
        usage = None

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return FakeResp()

    adapter = OpenAICompatAdapter(
        api_key="k",
        base_url="https://example.com/v1",
        model="gpt-4o-mini",
        deepseek_compat=False,
    )
    monkeypatch.setattr(adapter._client.chat.completions, "create", fake_create)
    tool = {
        "type": "function",
        "function": {"name": "get_date", "description": "d", "parameters": {"type": "object", "properties": {}}},
    }

    async def _run() -> None:
        await adapter.chat([{"role": "user", "content": "hi"}], tools=[tool])

    asyncio.run(_run())
    assert captured.get("parallel_tool_calls") is True
    assert "extra_body" not in captured


def test_openai_compat_assistant_tool_calls_get_reasoning_placeholder() -> None:
    """thinking 网关要求回放 assistant+tool_calls 时含 reasoning_content（子任务等路径此前会漏）。"""
    from solaire.agent_layer.llm.openai_compat import _ensure_assistant_tool_calls_have_reasoning

    msgs: list = [
        {"role": "system", "content": "x"},
        {"role": "user", "content": "y"},
        {"role": "assistant", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "f", "arguments": "{}"}}]},
    ]
    _ensure_assistant_tool_calls_have_reasoning(msgs)
    assert msgs[2].get("reasoning_content") == ""
    msgs2 = [{"role": "assistant", "tool_calls": [{"id": "c1"}], "reasoning_content": "已有"}]
    _ensure_assistant_tool_calls_have_reasoning(msgs2)
    assert msgs2[0]["reasoning_content"] == "已有"


def test_compact_for_llm_preserves_graph_node_total() -> None:
    """超大 graph.list_nodes 结果不得被压成空 dict，否则模型会误判图谱无节点。"""
    from solaire.agent_layer.compactor import compact_for_llm
    from solaire.agent_layer.context import tool_result_to_content

    big_nodes = [
        {
            "id": f"math/n{i}",
            "canonical_name": f"节点{i}" * 30,
            "node_kind": "concept",
            "subject": "数学",
            "level": "高考",
            "description": "x" * 400,
        }
        for i in range(120)
    ]
    payload = {"nodes": big_nodes, "kind_counts": {"causal": 0, "concept": 120, "skill": 0}}
    compacted, _ = compact_for_llm(payload, max_chars=10000)
    assert isinstance(compacted, dict)
    assert compacted.get("node_total") == 120
    assert compacted.get("kind_counts") == payload["kind_counts"]
    assert isinstance(compacted.get("nodes"), list)
    assert len(compacted["nodes"]) >= 1
    text = tool_result_to_content("graph.list_nodes", payload)
    assert "node_total" in text
    assert '"120"' in text or "120" in text


def test_vivace_needs_fast_model_review_flags() -> None:
    assert vivace_needs_fast_model_review("graph.delete_node") is True
    assert vivace_needs_fast_model_review("memory.read_index") is False


def test_vivace_pipeline_blocks_fast_review_tool(tmp_path: Path) -> None:
    save_safety_mode(tmp_path, SAFETY_MODE_VIVACE)
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool(
        "agent.run_tool_pipeline",
        {
            "steps": [
                {"tool": "graph.delete_node", "arguments": {"node_id": "missing"}},
            ]
        },
        ctx,
    )
    assert tr.status == "failed"
    assert tr.error_code == "needs_confirmation"
    assert tr.error_message and "管道" in tr.error_message


def test_vivace_pipeline_allows_read_step(tmp_path: Path) -> None:
    ensure_memory_layout(tmp_path)
    save_safety_mode(tmp_path, SAFETY_MODE_VIVACE)
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool(
        "agent.run_tool_pipeline",
        {"steps": [{"tool": "memory.read_index", "arguments": {}}]},
        ctx,
    )
    assert tr.status == "succeeded"


def test_batch_create_nodes_all_failed_status(tmp_path: Path) -> None:
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool(
        "graph.batch_create_nodes",
        {"nodes": [{"canonical_name": "", "parent_node_id": "p"}]},
        ctx,
    )
    assert tr.status == "failed"
    assert tr.error_code == "batch_all_failed"
    assert tr.data.get("error_count", 0) >= 1


def test_batch_create_nodes_partial_success_reports_counts(tmp_path: Path) -> None:
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool(
        "graph.batch_create_nodes",
        {
            "nodes": [
                {"canonical_name": ""},
                {"id": "math/t1", "canonical_name": "测试根要点", "node_kind": "concept"},
            ]
        },
        ctx,
    )
    assert tr.status == "succeeded"
    assert tr.data.get("partial_success") is True
    assert tr.data.get("ok_count") == 1
    assert tr.data.get("error_count") == 1
    from solaire.agent_layer.compactor import summarize_tool_result

    summ = summarize_tool_result("graph.batch_create_nodes", tr.data)
    assert "成功" in summ and "未成功" in summ


def test_batch_bind_questions_parse_only_fails(tmp_path: Path) -> None:
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=SessionState(session_id="s1"))
    tr = invoke_registered_tool(
        "graph.batch_bind_questions",
        {"bindings": [{"question_qualified_id": "", "node_id": ""}]},
        ctx,
    )
    assert tr.status == "failed"
    assert tr.error_code == "batch_all_failed"


def test_consecutive_subtask_indices_two_under_prestissimo(tmp_path: Path) -> None:
    save_safety_mode(tmp_path, SAFETY_MODE_PRESTISSIMO)
    sess = SessionState(session_id="s1")
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=sess, mode="execute")
    tcs = [
        {"function": {"name": "agent.run_subtask", "arguments": '{"objective":"a"}'}},
        {"function": {"name": "agent.run_subtask", "arguments": '{"objective":"b"}'}},
    ]
    idx = consecutive_subtask_tool_indices(tcs, 0, ctx, SAFETY_MODE_PRESTISSIMO)
    assert idx == [0, 1]


def test_select_tools_plan_mode_merges_file_write_edit(tmp_path: Path) -> None:
    names = {
        t.name
        for t in select_tools_for_turn(
            skill_id=None,
            include_subtask=False,
            current_focus="general",
            project_root=tmp_path,
            plan_mode_active=True,
        )
    }
    assert "file.write" in names
    assert "file.edit" in names


def test_plan_mode_write_restricted_to_plans_dir(tmp_path: Path) -> None:
    sess = SessionState(session_id="s1", plan_mode_active=True)
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=sess)
    tr = file_tools.tool_file_write(ctx, {"path": "other/file.md", "content": "x"})
    assert tr.status == "failed"
    assert tr.error_message and "plans" in tr.error_message


def test_plan_mode_plan_md_requires_yaml_todos(tmp_path: Path) -> None:
    sess = SessionState(session_id="s1", plan_mode_active=True)
    ctx = InvocationContext(project_root=tmp_path, session_id="s1", session=sess)
    rel = ".solaire/agent/plans/p.md"
    bad_fm = file_tools.tool_file_write(ctx, {"path": rel, "content": "# no frontmatter\n"})
    assert bad_fm.status == "failed"
    good = file_tools.tool_file_write(
        ctx,
        {
            "path": rel,
            "content": (
                "---\n"
                "name: t\n"
                "overview: o\n"
                "todos:\n"
                "  - id: a\n"
                "    content: c\n"
                "    status: pending\n"
                "---\n"
                "\n"
                "## 正文\n"
            ),
        },
    )
    assert good.status == "succeeded"


def test_steps_from_plan_body_maps_todos() -> None:
    text = (
        "---\n"
        "name: n\n"
        "overview: o\n"
        "todos:\n"
        "  - id: x1\n"
        "    content: 第一步\n"
        "    status: pending\n"
        "  - id: x2\n"
        "    content: 第二步\n"
        "    status: done\n"
        "---\n"
        "\n"
        "## 正文\n"
    )
    steps = steps_from_plan_body(text)
    assert len(steps) == 2
    assert steps[0]["title"] == "x1: 第一步"
    assert steps[0]["status"] == "pending"
    assert steps[1]["title"] == "x2: 第二步"
    assert steps[1]["status"] == "done"


def test_load_plan_steps_from_rel_path_reads_file(tmp_path: Path) -> None:
    rel = ".solaire/agent/plans/t.md"
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        "---\n"
        "name: n\n"
        "overview: o\n"
        "todos:\n"
        "  - id: only\n"
        "    content: 任务\n"
        "    status: pending\n"
        "---\n\n",
        encoding="utf-8",
    )
    steps = load_plan_steps_from_rel_path(tmp_path, rel)
    assert len(steps) == 1
    assert "任务" in steps[0]["title"]


def test_emit_memory_after_assistant_turn_skips_trivial_chat(tmp_path: Path) -> None:
    ensure_memory_layout(tmp_path)
    session = SessionState(session_id="m1")
    events: list[tuple[str, dict]] = []

    async def _emit(ev: str, data: dict) -> None:
        events.append((ev, data))

    async def _run() -> None:
        await emit_memory_after_assistant_turn(
            tmp_path,
            session,
            user_message="好的",
            assistant_text="收到",
            emit=_emit,
        )

    asyncio.run(_run())
    assert not any(ev == "memory_updated" for ev, _ in events)
    assert read_topic(tmp_path, "analysis_history.md") == ""
    assert read_topic(tmp_path, "session_digest.md") == ""


def test_emit_memory_after_assistant_turn_respects_skip_flag(tmp_path: Path) -> None:
    ensure_memory_layout(tmp_path)
    session = SessionState(session_id="m2")
    events: list[tuple[str, dict]] = []

    async def _emit(ev: str, data: dict) -> None:
        events.append((ev, data))

    async def _run() -> None:
        await emit_memory_after_assistant_turn(
            tmp_path,
            session,
            user_message="请分析这次月考数学错因",
            assistant_text="本次分析显示函数与几何综合题是主要薄弱点，建议分层训练。",
            emit=_emit,
            skip_memory_write=True,
        )

    asyncio.run(_run())
    assert not any(ev == "memory_updated" for ev, _ in events)
    assert read_topic(tmp_path, "analysis_history.md") == ""
    assert read_topic(tmp_path, "session_digest.md") == ""


# ---------------------------------------------------------------------------
# _sanitize_tool_chains: multi-tool-call groups must be preserved
# ---------------------------------------------------------------------------


def test_sanitize_tool_chains_preserves_multi_tool_group() -> None:
    """assistant 返回多个 tool_calls 时，所有 tool 响应都应保留。"""
    from solaire.agent_layer.context import _sanitize_tool_chains

    msgs = [
        {"role": "system", "content": "s"},
        {"role": "user", "content": "u"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "a", "arguments": "{}"}},
                {"id": "c2", "type": "function", "function": {"name": "b", "arguments": "{}"}},
                {"id": "c3", "type": "function", "function": {"name": "c", "arguments": "{}"}},
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "r1"},
        {"role": "tool", "tool_call_id": "c2", "content": "r2"},
        {"role": "tool", "tool_call_id": "c3", "content": "r3"},
        {"role": "user", "content": "u2"},
    ]
    _sanitize_tool_chains(msgs, start=1)
    tool_msgs = [m for m in msgs if m.get("role") == "tool"]
    assert len(tool_msgs) == 3
    assert {m["tool_call_id"] for m in tool_msgs} == {"c1", "c2", "c3"}


def test_sanitize_tool_chains_fills_missing_tool_responses() -> None:
    """assistant 有 3 个 tool_calls 但只有 1 条 tool 响应时，应补全缺失的。"""
    from solaire.agent_layer.context import _sanitize_tool_chains

    msgs = [
        {"role": "system", "content": "s"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "a", "arguments": "{}"}},
                {"id": "c2", "type": "function", "function": {"name": "b", "arguments": "{}"}},
                {"id": "c3", "type": "function", "function": {"name": "c", "arguments": "{}"}},
            ],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "r1"},
    ]
    _sanitize_tool_chains(msgs, start=1)
    tool_msgs = [m for m in msgs if m.get("role") == "tool"]
    assert len(tool_msgs) == 3
    filled_ids = {m["tool_call_id"] for m in tool_msgs}
    assert filled_ids == {"c1", "c2", "c3"}


def test_fold_tool_outputs_preserves_tool_call_ids() -> None:
    """折叠旧工具链输出时保留 tool_call_id 与分段结构。"""
    from solaire.agent_layer.context import _fold_tool_outputs_outside_recent_chains, _sanitize_tool_chains

    stub = "[stub]"
    msgs = [
        {"role": "system", "content": "x"},
        {"role": "system", "content": "y"},
        {
            "role": "assistant",
            "tool_calls": [{"id": "o1", "type": "function", "function": {"name": "f", "arguments": "{}"}}],
        },
        {"role": "tool", "tool_call_id": "o1", "name": "f", "content": "OLD_OUT"},
        {
            "role": "assistant",
            "tool_calls": [{"id": "n1", "type": "function", "function": {"name": "f", "arguments": "{}"}}],
        },
        {"role": "tool", "tool_call_id": "n1", "content": "NEW_OUT"},
    ]
    _sanitize_tool_chains(msgs, start=2)
    _fold_tool_outputs_outside_recent_chains(msgs, start=2, keep_recent=1, general_stub=stub, skill_stub=stub)
    _sanitize_tool_chains(msgs, start=2)
    assert msgs[3]["tool_call_id"] == "o1"
    assert msgs[3]["content"] == stub
    assert msgs[5]["tool_call_id"] == "n1"
    assert msgs[5]["content"] == "NEW_OUT"


def test_whitelist_project_ctx_for_prompt() -> None:
    from solaire.agent_layer.prompts import whitelist_project_ctx_for_prompt

    raw = {"project_label": "p", "graph_subjects": [], "exam_summary": "e", "template_count": 1}
    slim = whitelist_project_ctx_for_prompt(raw)
    assert "graph_subjects" not in slim
    assert slim["exam_summary"] == "e"


def test_build_messages_at_most_two_leading_systems() -> None:
    """任务步骤并入动态 system，不得超过两条前缀 system。"""
    from solaire.agent_layer.context import ContextManager

    sess = SessionState(session_id="s2")
    sess.task_plan = [{"title": "一步", "status": "pending"}]
    cm = ContextManager(include_subtask_tool=False)
    from solaire.agent_layer.registry import select_tools_for_turn

    tools = select_tools_for_turn(
        skill_id=None,
        include_subtask=False,
        current_focus="general",
        project_root=None,
        plan_mode_active=False,
    )
    pref, suf = cm.build_system_parts(
        {"project_label": "x", "exam_summary": "无", "template_count": 0, "graph_node_count": 0},
        session=sess,
        tools=tools,
        current_focus="general",
        plan_mode_active=False,
        execution_plan_path=None,
        skill_catalog="",
        page_context_brief="",
    )
    msgs = cm.build_messages(system_prefix=pref, system_suffix=suf, session=sess, user_message="")
    lead = 0
    for m in msgs:
        if m.get("role") != "system":
            break
        lead += 1
    assert lead == 2
    merged = suf
    assert "当前任务进度" in merged


def test_select_tools_compose_more_than_general(tmp_path: Path) -> None:
    g = select_tools_for_turn(
        skill_id=None,
        include_subtask=True,
        current_focus=None,
        project_root=tmp_path,
        plan_mode_active=False,
    )
    comp = select_tools_for_turn(
        skill_id=None,
        include_subtask=True,
        current_focus="compose",
        project_root=tmp_path,
        plan_mode_active=False,
    )
    assert len(comp) >= len(g)


# ---------------------------------------------------------------------------
# Wire name conversion: round-trip and all-compat coverage
# ---------------------------------------------------------------------------


def test_wire_name_roundtrip() -> None:
    from solaire.agent_layer.llm.openai_compat import _tool_name_wire_inbound, _tool_name_wire_outbound

    canonical = "analysis.list_datasets"
    wire = _tool_name_wire_outbound(canonical)
    assert "." not in wire
    restored = _tool_name_wire_inbound(wire)
    assert restored == canonical


def test_compat_adapter_converts_tool_names_for_all_modes() -> None:
    """即使 deepseek_compat=False，工具名也应被转换。"""
    from solaire.agent_layer.llm.openai_compat import _prepare_compat_request_payload

    tools = [
        {"type": "function", "function": {"name": "graph.list_nodes", "description": "d", "parameters": {}}}
    ]
    _, t2 = _prepare_compat_request_payload([], tools)
    assert t2 is not None
    assert t2[0]["function"]["name"] == "graph_list_nodes"


# ---------------------------------------------------------------------------
# Stable system prompt hash stability
# ---------------------------------------------------------------------------


def test_stable_prompt_hash_does_not_change_across_calls() -> None:
    from solaire.agent_layer.prompts import build_stable_system_prompt
    from solaire.agent_layer.llm.prompt_cache import hash_text_sha12

    h1 = hash_text_sha12(build_stable_system_prompt())
    h2 = hash_text_sha12(build_stable_system_prompt())
    assert h1 == h2


def test_stable_prompt_excludes_tool_descriptions() -> None:
    from solaire.agent_layer.prompts import build_stable_system_prompt

    txt = build_stable_system_prompt()
    assert "可用能力（通过工具调用）" not in txt
