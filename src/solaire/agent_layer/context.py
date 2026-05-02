"""Build chat messages with token budget and compaction hooks."""

from __future__ import annotations

import json
from typing import Any

from solaire.agent_layer.compactor import compact_for_llm
from solaire.agent_layer.llm.message_utils import ensure_assistant_tool_calls_have_reasoning as _ensure_assistant_tool_calls_have_reasoning
from solaire.agent_layer.models import ChatMessage, SessionState
from solaire.agent_layer.prompts import build_system_prompt, build_system_prompt_cached
from solaire.agent_layer.registry import RegisteredTool, all_registered_tools, tool_descriptions_for_prompt
from solaire.agent_layer.task_tracker import build_task_plan_dynamic_block
from solaire.agent_layer.llm.token_budget import estimate_messages_tokens


def _history_prefix_len(messages: list[dict[str, Any]]) -> int:
    """`build_messages` 前缀为连续的 system（固定两条：cacheable_prefix + dynamic_suffix），其后是会话历史。"""
    count = 0
    for m in messages:
        if m.get("role") != "system":
            break
        count += 1
    return count


def _tool_chain_spans(messages: list[dict[str, Any]], *, start: int) -> list[tuple[int, int]]:
    """每一段为 [assistant+tool_calls, end)，end 为该轮 tool 消息后一位索引。"""
    spans: list[tuple[int, int]] = []
    i = start
    n = len(messages)
    while i < n:
        m = messages[i]
        if m.get("role") == "assistant" and m.get("tool_calls"):
            j = i + 1
            while j < n and messages[j].get("role") == "tool":
                j += 1
            spans.append((i, j))
            i = j
        else:
            i += 1
    return spans


def _fold_tool_outputs_outside_recent_chains(
    messages: list[dict[str, Any]],
    *,
    start: int,
    keep_recent: int,
    general_stub: str,
    skill_stub: str,
) -> None:
    """保留最近几条完整工具链的输出；更旧链内 tool.content 收紧为占位（不改变 tool_call_id / 顺序）。"""
    spans = _tool_chain_spans(messages, start=start)
    if len(spans) <= keep_recent:
        return
    protect = {(a, b) for a, b in spans[-keep_recent:]}
    for a, b in spans:
        if (a, b) in protect:
            continue
        for k in range(a + 1, b):
            if messages[k].get("role") != "tool":
                continue
            name = messages[k].get("name") or ""
            txt = messages[k].get("content") or ""
            use_skill = (
                name in ("agent.activate_skill", "agent.read_skill_reference")
                or '"agent.activate_skill"' in txt
                or '"agent.read_skill_reference"' in txt
            )
            messages[k]["content"] = skill_stub if use_skill else general_stub


def _fold_reasoning_non_tool_assistants(
    messages: list[dict[str, Any]],
    *,
    start: int,
    keep_recent_tool_chains: int,
) -> None:
    """对「早于最近完整工具链」的非工具助手轮次，清空 reasoning_content。"""
    spans = _tool_chain_spans(messages, start=start)
    if len(spans) <= keep_recent_tool_chains:
        return
    cutoff = spans[-keep_recent_tool_chains][0]
    for i in range(start, cutoff):
        m = messages[i]
        if m.get("role") != "assistant" or m.get("tool_calls"):
            continue
        if m.get("reasoning_content"):
            m["reasoning_content"] = ""


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
    TOKEN_BUDGET_TOTAL = 200000
    # 软压缩阈值设为接近模型上下文极限（~160K），避免过早 stub 破坏 KV Cache 前缀匹配。
    # DeepSeek 的 common prefix detection 需要多次请求才能注册独立前缀单元；
    # 过早压缩会改变历史消息字节，导致缓存命中率大幅下降。
    HISTORY_SOFT_BUDGET_TOKENS = 160000
    KEEP_RECENT_TOOL_CHAINS_SOFT = 6

    def __init__(self, *, include_subtask_tool: bool = True) -> None:
        self.include_subtask_tool = include_subtask_tool

    def build_system_parts(
        self,
        project_ctx: dict[str, Any],
        *,
        session: SessionState,
        tools: list[RegisteredTool] | None = None,
        skill_guidance: str | None = None,
        current_focus: str | None = None,
        plan_mode_active: bool = False,
        execution_plan_path: str | None = None,
        skill_catalog: str | None = None,
        page_context_brief: str | None = None,
        include_focus_info: bool = True,
    ) -> tuple[str, str]:
        """Return (cacheable_prefix, dynamic_suffix) for two system messages.

        Stable prefix (role + constraints + tools) goes in first system message.
        Dynamic info (context / focus / plan state) goes in second system message.
        This split keeps the prefix byte-identical across turns for KV Cache hits.
        """
        tlist = tools
        if tlist is None:
            tlist = all_registered_tools(include_subtask=self.include_subtask_tool)
        desc = tool_descriptions_for_prompt(tlist)
        root = project_ctx.get("_project_root")
        public_ctx = {k: v for k, v in project_ctx.items() if not str(k).startswith("_") and k != "page_context"}
        task_plan_block = build_task_plan_dynamic_block(session)
        return build_system_prompt_cached(
            tool_descriptions=desc,
            project_ctx=public_ctx,
            skill_guidance=skill_guidance,
            current_focus=current_focus,
            plan_mode_active=plan_mode_active,
            execution_plan_path=execution_plan_path,
            skill_catalog=skill_catalog,
            task_plan_block=task_plan_block or None,
            page_context_brief=None,  # moved to user message prefix for KV cache stability
            project_root=root,
            include_focus_info=include_focus_info,
        )

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
        """Legacy: return single joined system prompt string."""
        tlist = tools
        if tlist is None:
            tlist = all_registered_tools(include_subtask=self.include_subtask_tool)
        desc = tool_descriptions_for_prompt(tlist)
        root = project_ctx.get("_project_root")
        public_ctx = {k: v for k, v in project_ctx.items() if not str(k).startswith("_") and k != "page_context"}
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
        system_content: str | None = None,
        system_prefix: str | None = None,
        system_suffix: str | None = None,
        session: SessionState,
        user_message: str,
    ) -> list[dict[str, Any]]:
        if system_prefix is not None:
            msgs: list[dict[str, Any]] = [
                {"role": "system", "content": system_prefix},
                {"role": "system", "content": system_suffix or ""},
            ]
        elif system_content is not None:
            msgs = [{"role": "system", "content": system_content}]
        else:
            msgs = []
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
        """折叠旧工具输出/推理，必要时删减最旧片段；始终在变更后重做 tool 链卫生。"""
        stub = "[较早的工具输出已折叠；如需细节请重新运行相应工具。]"
        stub_skill = "[较早的技能载入或参考资料内容已省略；需要时请重新激活或读取参考。]"
        prefix = _history_prefix_len(messages)
        min_tail = 2

        def _est() -> int:
            return estimate_messages_tokens(messages)

        _sanitize_tool_chains(messages, start=prefix)
        if _est() > self.HISTORY_SOFT_BUDGET_TOKENS:
            _fold_tool_outputs_outside_recent_chains(
                messages,
                start=prefix,
                keep_recent=self.KEEP_RECENT_TOOL_CHAINS_SOFT,
                general_stub=stub,
                skill_stub=stub_skill,
            )
            _sanitize_tool_chains(messages, start=prefix)
            _fold_reasoning_non_tool_assistants(
                messages,
                start=prefix,
                keep_recent_tool_chains=self.KEEP_RECENT_TOOL_CHAINS_SOFT,
            )

        while _est() > self.TOKEN_BUDGET_TOTAL and len(messages) > prefix + min_tail:
            stubbed = False
            for i in range(prefix, max(prefix, len(messages) - 1)):
                m = messages[i]
                if m.get("role") == "tool" and (m.get("content") or "") not in (stub, stub_skill):
                    m["content"] = stub
                    stubbed = True
                    break
            if stubbed:
                _sanitize_tool_chains(messages, start=prefix)
                continue
            if not _drop_oldest_history_segment(messages, prefix_len=prefix):
                break
            _sanitize_tool_chains(messages, start=prefix)


def tool_result_to_content(tool_name: str, data: dict[str, Any]) -> str:
    payload, _ = compact_for_llm(data, max_chars=10000)
    return json.dumps({"tool": tool_name, "result": payload}, ensure_ascii=False, default=str)
