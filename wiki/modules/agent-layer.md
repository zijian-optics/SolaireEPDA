# 智能助手层（agent_layer）行为约定

本文档摘要后端 `src/solaire/agent_layer/` 与 HTTP 接口的契约，便于排查「助手做了但界面不一致」等问题。详细字段以 [Agent API（docs/api/agent.md）](../../docs/api/agent.md) 为准。

## 模型调用适配

- 编排层（`orchestrator`）通过 `ModelRouter` 按 `LLMSettings.provider` 选择实现：`openai` → Responses API；`anthropic` → Messages API；`openai_compat` 与 `deepseek` → OpenAI 兼容 Chat Completions（DeepSeek 未填地址时使用官方默认地址）。**DeepSeek**：按官方说明在请求中附带 `extra_body.thinking` 与 `reasoning_effort`（`high` / `max`，默认 `high`，可经环境变量或覆盖文件配置），不向该端点发送 `parallel_tool_calls`，且流式请求不启用 `stream_options`；由于 OpenAI 官方 Python SDK 会裁剪请求体中的 `messages` 并丢弃 `reasoning_content`，DeepSeek 模式下另通过合并 `extra_body.messages`（完整历史副本）发往网关。**上下文用量（侧栏）**：在 DeepSeek 兼容网关下，服务端用仓库内 `deepseek_v3_tokenizer/tokenizer.json`（经 `tokenizers` 库）估算 `context_tokens_est`，SSE `context_metrics` / `done` 可带 `context_limit`（产品口径 **1,000,000**）。工具名须符合 `^[a-zA-Z0-9_-]+$`，**所有 `openai_compat` 适配器**（不限 DeepSeek）在出站时将内部的 `前缀.名称` 转为下划线形式（含工具定义、助手 `tool_calls[].function.name` 与工具结果消息的 `name` 字段），入站再还原；反向映射从 `_TOOL_BY_NAME` 实时构建（无缓存），焦点切换后不会失效。
- 会话消息在内部仍统一为既有 Chat 形状（含 `tool_calls` / `tool` 角色），由各适配器在出站时转换为厂商协议。

## 上下文与可观测性

- 系统提示分为三层：**稳定层**（角色、任务范围、约束、风险策略、输出规范、决策规则——不含工具表）→ **工具块**（当前聚焦域下的工具描述，焦点与技能不变则 hash 恒定）→ **动态层**（白名单内的项目摘要、聚焦域文案、任务步骤摘要、技能目录、`page_context` 汇总的短「界面速览」等）。其中 **第三条独立 system 已不再使用**：任务步骤摘要并入第二条动态 system。**App 传来的 `page_context`** 仅进入动态摘要，不参与工具筛选与 `tool_schema_sha12`。稳定层 hash 在同一会话内不变，便于对接前缀类上下文缓存。
- **软预算**（约 96k token）：先保留最近几条完整工具链，将更早链路内 `tool` 输出收窄为占位，并对早于该范围的非工具助手轮清空 `reasoning_content`。若仍超限，再走总预算分支。
- **总预算**（默认约 200k token）：先将较早的 `tool` 输出折叠为短占位；仍超限则按**整段**丢弃最旧历史（`user` 轮到下一 `user`；含 `tool_calls` 的 `assistant` 与其后连续 `tool` 同删）。任一压缩路径后均需：(1) 剔除孤儿 `tool`；(2) 为每个 `assistant+tool_calls` 补全缺失的 `tool_call_id` 响应，以满足严格网关对工具链顺序的要求。**DeepSeek KV 前缀缓存**：尽量保持第一条 `system`(稳定层+工具块) 字节级稳定；易变业务信息留在第二条动态 `system`，任务步骤不写第三条独立消息。
- 每轮 **主模型推理完成后**推送 SSE `context_metrics`（与当轮用量、`history_sha12`、分项动态 hash、`provider_system_shape` 对齐），详见 `docs/api/agent.md`。在 DeepSeek 兼容模式下另含 `context_tokens_est` 与 `context_limit`（100 万口径），供侧栏进度展示。无 SSE 时（如切换历史会话）可调用 `GET /api/agent/sessions/{id}/context-meter`：由 `context_meter.context_meter_for_session` 复用与编排层相同的 `ContextManager.build_*` + `estimate_context_prompt_tokens`。工具集仅在显式切换聚焦域、`plan_mode_active` 变化或技能收窄时重建，不因 `page_context` 变化抖动。

## 计划模式与执行审批

- 助手在计划模式中仅向 `.solaire/agent/plans/` 落盘结构化计划；`agent.exit_plan_mode` 会校验路径、文件存在性及正文 YAML 围栏（须含 `name`、`overview`、`todos`）。
- 推送 `plan_ready` 后，会话内记录**待执行计划路径**；**仅当**前端在侧栏点击「执行」并在 `/api/agent/chat` 中传入一致的 `execution_plan_path` 时，服务端才进入「计划执行」提示并加载步骤。任意不匹配或跳过界面确认会得到 `error`（`plan_not_approved` / `invalid_plan`）。
- 侧栏「取消」会发送 `clear_pending_plan_path`，清除待执行状态。

## 组卷导出一致性

- 工具的 `exam.export_paper` 与组卷页导出共享 `build.yaml` 备份/恢复、`mark_exported`、失败草稿（`save_exam_workspace_after_export_failure`）等逻辑；若检测到「相同试卷说明与学科」已被**其他**目录占用，须传 `allow_replace_conflicting_export: true` 才继续，避免静默覆盖。

## 子任务（run_subtask）

- 子任务**不挂载**主会话的 `SessionState`，避免计划模式、聚焦域、任务步骤被并行推理污染。
- 子任务工具集排除会话类与项目落盘类工具；Vivace 下仍对高危工具走快模型复核（未配置快模型时可能要求回到主对话）。

## 记忆（已停用自动写入）

- 自动记忆写入已禁用（`emit_memory_after_assistant_turn` 为空操作）。此前每轮自动追加的对话碎片（截断到 120-160 字）无实际跨会话召回价值，且注入系统提示导致 dynamic hash 频繁变化、缓存失效。
- `memory.py`、`memory_tools.py` 及 `memory.*` 只读工具（`read_index` / `read_topic` / `search`）保留，使已有记忆文件仍可被教师主动查询。
- `.solaire/agent/memory/` 目录内容不会被自动删除。

## 回合结束与确认

- 需要教师确认时，在 `confirm_needed` 之后通常会有 `done`，且带 `awaiting_confirmation: true`，表示流已结束、等待用户在侧栏点确认而非仍在生成。
- 主对话不再按固定「推理轮数」上限截断；仅当模型在多轮中**重复发起完全相同的工具调用批次**（函数名与参数规范化后一致）达到阈值时推送 `error`（`repeat_loop`）并写入一条助手说明终止本轮。纯文本因输出上限被截断时不再自动插入「继续」类用户消息。

## 题库工具与 JSON 中的反斜杠

- `bank.create_item` / `bank.update_item` 的字符串参数由标准 `json.loads` 解析（见 `parse_tool_arguments`），**不会在应用层二次反转义**。
- `save_question` 使用 `yaml.safe_dump`：若 Python 字符串里已有**两个**字面反斜杠再接到 `\mathrm` 等，落盘会写成 `content: $\\mathrm{...}$`；若只有一个反斜杠，落盘为 `content: $\mathrm{...}$`（与选项行一致）。
- 题干出现「多一个反斜杠」而解析/选项正常时，优先查**工具调用 JSON 是否被模型双重转义**（在嵌套 JSON 日志里常表现为成倍的 `\`），而非怀疑 `yaml.safe_load` 或 `bank.get_item`。

## 验证命令（开发者）

```bash
pixi run pytest tests/test_user_llm_overrides.py tests/test_llm_router.py tests/test_agent_layer.py tests/test_agent_plan_and_subagent.py -v
```
