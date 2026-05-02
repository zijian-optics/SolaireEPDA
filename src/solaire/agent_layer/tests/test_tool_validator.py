"""Unit tests for tool_validator.py"""

from __future__ import annotations

import pytest

from solaire.agent_layer.tool_validator import (
    ValidatedToolCall,
    _check_required_params,
    _name_matches,
    validate_tool_call,
)
from solaire.agent_layer.tools.tool_definitions import RegisteredTool, ToolRisk


def _make_tool(name: str, required: list[str] | None = None) -> RegisteredTool:
    props: dict[str, dict[str, str]] = {}
    if required:
        for r in required:
            props[r] = {"type": "string"}
    schema: dict[str, object] = {"type": "object", "properties": props}
    if required:
        schema["required"] = required
    return RegisteredTool(
        name=name,
        description=f"Tool {name}",
        parameters_schema=schema,
        handler=lambda ctx, args: None,
        risk=ToolRisk.READ,
    )


# --- _name_matches ---


class TestNameMatches:
    def test_exact_match(self):
        corrected, suggestion = _name_matches("file.read", ["file.read", "file.write"])
        assert corrected == "file.read"
        assert suggestion is None

    def test_underscore_to_dot_auto_correct(self):
        corrected, suggestion = _name_matches(
            "agent_run_subtask", ["agent.run_subtask", "file.read"]
        )
        assert corrected == "agent.run_subtask"
        assert "已自动纠正" in (suggestion or "")

    def test_fuzzy_close_match_single(self):
        corrected, suggestion = _name_matches(
            "file.readd", ["file.read", "file.write", "graph.list_nodes"]
        )
        # difflib may auto-correct or return suggestions depending on string length
        assert corrected == "file.read" or (suggestion and "file.read" in suggestion)

    def test_fuzzy_multiple_no_auto_correct(self):
        corrected, suggestion = _name_matches(
            "file.red", ["file.read", "file.write"]
        )
        # file.red differs by 2 chars from each, but get_close_matches with cutoff=0.6 may yield results
        # The result depends on difflib's behavior
        # If multiple close matches, we expect suggestion with list, not auto-correct
        if corrected is not None:
            assert suggestion is None or "已自动纠正" in str(suggestion)
        else:
            assert suggestion is not None
            assert "您可能想使用" in (suggestion or "")

    def test_no_match_lists_tools(self):
        corrected, suggestion = _name_matches(
            "completely.nonexistent", ["file.read", "file.write", "graph.list_nodes"]
        )
        assert corrected is None
        assert "未知工具" in (suggestion or "")
        assert "file.read" in (suggestion or "")


# --- _check_required_params ---


class TestCheckRequiredParams:
    def test_all_present(self):
        ok, err = _check_required_params(
            {"name": "test", "code": "print(1)"},
            {"type": "object", "required": ["name", "code"]},
        )
        assert ok is True
        assert err is None

    def test_missing_required(self):
        ok, err = _check_required_params(
            {"code": "print(1)"},
            {"type": "object", "required": ["name", "code"]},
        )
        assert ok is False
        assert "name" in (err or "")

    def test_no_required_in_schema(self):
        ok, err = _check_required_params(
            {"foo": "bar"},
            {"type": "object", "properties": {"foo": {"type": "string"}}},
        )
        assert ok is True
        assert err is None

    def test_empty_arguments(self):
        ok, err = _check_required_params(
            {},
            {"type": "object", "required": ["query"]},
        )
        assert ok is False
        assert "query" in (err or "")


# --- validate_tool_call integration ---


class TestValidateToolCall:
    def test_valid_call(self):
        tools = [
            _make_tool("bank.search_items", required=["query"]),
            _make_tool("file.read", required=["path"]),
        ]
        result = validate_tool_call(
            "bank.search_items",
            '{"query": "test", "max_hits": 10}',
            tools,
        )
        assert result.is_valid
        assert result.tool_name == "bank.search_items"
        assert result.arguments == {"query": "test", "max_hits": 10}

    def test_hallucinated_name_auto_correct(self):
        tools = [
            _make_tool("agent.run_subtask", required=["objective"]),
            _make_tool("file.read", required=["path"]),
        ]
        result = validate_tool_call(
            "agent_run_subtask",
            '{"objective": "do something"}',
            tools,
        )
        assert result.is_valid
        assert result.tool_name == "agent.run_subtask"

    def test_missing_required_param(self):
        tools = [_make_tool("bank.search_items", required=["query"])]
        result = validate_tool_call("bank.search_items", "{}", tools)
        assert not result.is_valid
        assert result.error_code == "missing_required"
        assert "query" in (result.error_message or "")

    def test_invalid_json_arguments(self):
        tools = [_make_tool("file.read", required=["path"])]
        result = validate_tool_call("file.read", '{"path": "x" broken}', tools)
        assert not result.is_valid
        assert result.error_code == "invalid_arguments"
        assert "JSON" in (result.error_message or "")

    def test_unknown_tool_with_suggestions(self):
        tools = [
            _make_tool("file.read"),
            _make_tool("file.write"),
        ]
        result = validate_tool_call("file.reda", "{}", tools)
        assert not result.is_valid
        assert result.error_code == "unknown_tool"
        # difflib should find file.read is close to file.reda
        assert result.suggestion is not None or "file.read" in str(result.error_message or "")

    def test_dict_arguments_passthrough(self):
        tools = [_make_tool("file.read", required=["path"])]
        result = validate_tool_call("file.read", {"path": "test.yaml"}, tools)
        assert result.is_valid
        assert result.arguments == {"path": "test.yaml"}

    def test_empty_tools_list(self):
        result = validate_tool_call("any.tool", "{}", [])
        assert not result.is_valid
        assert result.error_code == "unknown_tool"
