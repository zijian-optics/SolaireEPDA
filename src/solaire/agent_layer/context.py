"""Build chat messages with token budget and compaction hooks."""

from __future__ import annotations

import json
from typing import Any

from solaire.agent_layer.compactor import compact_for_llm
from solaire.agent_layer.llm.message_utils import ensure_assistant_tool_calls_have_reasoning as _ensure_assistant_tool_calls_have_reasoning
from solaire.agent_layer.models import ChatMessage, SessionState
from solaire.agent_layer.prompts import build_system_prompt
from solaire.agent_layer.registry import RegisteredTool, all_registered_tools, tool_descriptions_for_prompt
from solaire.agent_layer.task_tracker import plan_to_prompt_block
from solaire.agent_layer.llm.token_budget import estimate_messages_tokens


def _history_prefix_len(messages: list[dict[str, Any]]) -> int:
    """`build_messages` 前 1～2 条为 system（含可选的计划 system），其后才是会话历史。"""
    if len(messages) >= 2 and messages[1].get("role") == "system":
        return 2
    return 1


def _sanitize_tool_chains(messages: list[dict[str, Any]], *, start: int) -> None:
    """移除「孤儿」tool 消息（前方无 assistant+tool_calls 锚点的），
    然后为每个 assistant+tool_calls 补全缺失的 tool 响应占位。"""
    # Pass 1: 删除孤儿 tool（向前回溯到最近的非 tool 消息，必须是 assistant+tool_calls）
    i = start
    while i < len(messages):
        if messages[i].get("role") != "tool":
            i += 1
            continue
        j = i - 1
        while j >= start and messages[j].get("role") == "tool":
            j -= 1
        anchor = messages[j] if j >= 0 else None
        if anchor is not None and anchor.get("role") == "assistant" and anchor.get("tool_calls"):
            i += 1
            continue
        messages.pop(i)

    # Pass 2: 确保每个 assistant+tool_calls 的所有 tool_call_id 都有对应 tool 响应
    i = start
    while i < len(messages):
        m = messages[i]
        if m.get("role") != "assistant" or not m.get("tool_calls"):
            i += 1
            continue
        expected_ids = {tc.get("id") for tc in m["tool_calls"] if tc.get("id")}
        j = i + 1
        while j < len(messages) and messages[j].get("role") == "tool":
            expected_ids.discard(messages[j].get("tool_call_id"))
            j += 1
        for missing_id in expected_ids:
            messages.insert(j, {
                "role": "tool",
                "tool_call_id": missing_id,
                "content": '{"error": "结果已丢失，请重新调用相应工具。"}',
            })
            j += 1
        i = j


def _drop_oldest_history_segment(messages: list[dict[str, Any]], *, prefix_len: int) -> bool:
    """在限定前缀（system）之后删除一段最旧历史，且不拆散 assistant↔tool 成对结构。"""
    if len(messages) <= prefix_len + 1:
        return False
    start = prefix_len
    role0 = messages[start].get("role")

    if role0 == "tool":
        end = start
        while end < len(messages) and messages[end].get("role") == "tool":
            end += 1
        del messages[start:end]
        return True

    if role0 == "assistant" and messages[start].get("tool_calls"):
        end = start + 1
        while end < len(messages) and messages[end].get("role") == "tool":
            end += 1
        del messages[start:end]
        return True

    if role0 == "user":
        end = start + 1
        while end < len(messages) and messages[end].get("role") != "user":
            end += 1
        del messages[start:end]
        return True

    del messages[start]
    return True


class ContextManager:
    TOKEN_BUDGET_TOTAL = 28000

    def __init__(self, *, include_subtask_tool: bool = True) -> None:
        self.include_subtask_tool = include_subtask_tool

    def build_system_content(
        self,
        project_ctx: dict[str, Any],
        *,
        tools: list[RegisteredTool] | None = None,
        skill_guidance: str | None = None,
        current_focus: str | None = None,
        plan_mode_active: bool = False,
        execution_plan_path: str | None = None,
        skill_catalog: str | None = None,
    ) -> str:
        tlist = tools
        if tlist is None:
            tlist = all_registered_tools(include_subtask=self.include_subtask_tool)
        desc = tool_descriptions_for_prompt(tlist)
        root = project_ctx.get("_project_root")
        public_ctx = {k: v for k, v in project_ctx.items() if not str(k).startswith("_")}
        return build_system_prompt(
            tool_descriptions=desc,
            project_ctx=public_ctx,
            skill_guidance=skill_guidance,
            current_focus=current_focus,
            plan_mode_active=plan_mode_active,
            execution_plan_path=execution_plan_path,
            skill_catalog=skill_catalog,
            project_root=root,
        )

    def build_messages(
        self,
        *,
        system_content: str,
        session: SessionState,
        user_message: str,
    ) -> list[dict[str, Any]]:
        msgs: list[dict[str, Any]] = [{"role": "system", "content": system_content}]
        plan = plan_to_prompt_block(session)
        if plan:
            msgs.append({"role": "system", "content": plan})
        for m in session.messages:
            d: dict[str, Any] = {"role": m.role}
            if m.role == "tool":
                d["content"] = m.content or ""
                d["tool_call_id"] = m.tool_call_id or ""
                if m.name:
                    d["name"] = m.name
            else:
                if m.content is not None:
                    d["content"] = m.content
                if m.reasoning_content is not None:
                    d["reasoning_content"] = m.reasoning_content
                if m.tool_calls:
                    d["tool_calls"] = m.tool_calls
                    if m.role == "assistant" and "reasoning_content" not in d:
                        d["reasoning_content"] = ""
            msgs.append(d)
        if user_message.strip():
            msgs.append({"role": "user", "content": user_message.strip()})
        prefix = _history_prefix_len(msgs)
        _sanitize_tool_chains(msgs, start=prefix)
        self._maybe_compact(msgs)
        _ensure_assistant_tool_calls_have_reasoning(msgs)
        return msgs

    def _maybe_compact(self, messages: list[dict[str, Any]]) -> None:
        """L2: fold oldest tool outputs into stubs; then drop oldest turns if still over budget."""
        stub = "[较早的工具输出已折叠；如需细节请重新运行相应工具。]"
        prefix = _history_prefix_len(messages)
        min_tail = 2
        while estimate_messages_tokens(messages) > self.TOKEN_BUDGET_TOTAL and len(messages) > prefix + min_tail:
            stubbed = False
            for i in range(prefix, max(prefix, len(messages) - 1)):
                m = messages[i]
                if m.get("role") == "tool" and (m.get("content") or "") != stub:
                    m["content"] = stub
                    stubbed = True
                    break
            if stubbed:
                continue
            if not _drop_oldest_history_segment(messages, prefix_len=prefix):
                break
            _sanitize_tool_chains(messages, start=prefix)


def tool_result_to_content(tool_name: str, data: dict[str, Any]) -> str:
    payload, _ = compact_for_llm(data, max_chars=10000)
    return json.dumps({"tool": tool_name, "result": payload}, ensure_ascii=False, default=str)
