# 智能助手层（agent_layer）行为约定

本文档摘要后端 `src/solaire/agent_layer/` 与 HTTP 接口的契约，便于排查「助手做了但界面不一致」等问题。详细字段以 [Agent API（docs/api/agent.md）](../../docs/api/agent.md) 为准。

## 模型调用适配

- 编排层（`orchestrator`）通过 `ModelRouter` 按 `LLMSettings.provider` 选择实现：`openai` → Responses API；`anthropic` → Messages API；`openai_compat` 与 `deepseek` → OpenAI 兼容 Chat Completions（DeepSeek 未填地址时使用官方默认地址）。**DeepSeek**：按官方说明在请求中附带 `extra_body.thinking` 与 `reasoning_effort`，不向该端点发送 `parallel_tool_calls`，且流式请求不启用 `stream_options`；由于 OpenAI 官方 Python SDK 会裁剪请求体中的 `messages` 并丢弃 `reasoning_content`，DeepSeek 模式下另通过合并 `extra_body.messages`（完整历史副本）发往网关。工具名须符合 `^[a-zA-Z0-9_-]+$`，**所有 `openai_compat` 适配器**（不限 DeepSeek）在出站时将内部的 `前缀.名称` 转为下划线形式（含工具定义、助手 `tool_calls[].function.name` 与工具结果消息的 `name` 字段），入站再还原；反向映射从 `_TOOL_BY_NAME` 实时构建（无缓存），焦点切换后不会失效。
- 会话消息在内部仍统一为既有 Chat 形状（含 `tool_calls` / `tool` 角色），由各适配器在出站时转换为厂商协议。

## 上下文与可观测性

- 系统提示分为三层：**稳定层**（角色、任务范围、约束、风险策略、输出规范、决策规则——不含工具表）→ **工具块**（当前焦点域下的工具描述，焦点不变则 hash 恒定）→ **动态层**（项目摘要、当前界面、计划态、技能目录等）。稳定层 hash 在同一会话内始终不变，利于对接各厂商「前缀缓存」。
- 当估算上下文 token 超过预算时，会先尝试将较早的 `tool` 输出折叠为短占位符；仍超限时按**整段**丢弃最旧历史（`user` 轮到下一 `user` 为止；含 `tool_calls` 的 `assistant` 与其后连续 `tool` 同删）。压缩后会：(1) 剔除「孤儿」`tool`（前方无 `assistant+tool_calls` 锚点）；(2) 为 `assistant+tool_calls` 中缺失对应 `tool` 响应的 `tool_call_id` 补占位消息，满足严格网关要求。
- 每轮向模型发起请求前会推送 SSE 事件 `context_metrics`（`stable_sha12`、`tools_block_sha12`、`dynamic_sha12`、`tool_schema_sha12`、`tool_count`、系统提示字符数、估算输入 token），便于在桌面端或日志中对照工具集是否抖动。

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
- 连续工具轮次耗尽时会推送 `error`（`max_rounds`）并写入一条助手说明，提示用户发送「继续」。

## 验证命令（开发者）

```bash
pixi run pytest tests/test_user_llm_overrides.py tests/test_llm_router.py tests/test_agent_layer.py tests/test_agent_plan_and_subagent.py -v
```
