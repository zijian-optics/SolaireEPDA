# 智能助手层（agent_layer）行为约定

本文档摘要后端 `src/solaire/agent_layer/` 与 HTTP 接口的契约，便于排查「助手做了但界面不一致」等问题。详细字段以 [Agent API（docs/api/agent.md）](../../docs/api/agent.md) 为准。

## 上下文与可观测性

- 系统提示分为**稳定层**（角色、任务范围、工具表、约束等）与**动态层**（项目摘要、当前界面、记忆摘录、计划态、技能目录等），利于后续对接各厂商「前缀缓存」类能力。
- 每轮向模型发起请求前会推送 SSE 事件 `context_metrics`（稳定/动态摘要哈希、系统提示字符数、估算输入 token），便于在桌面端或日志中对照。

## 计划模式与执行审批

- 助手在计划模式中仅向 `.solaire/agent/plans/` 落盘结构化计划；`agent.exit_plan_mode` 会校验路径、文件存在性及正文 YAML 围栏（须含 `name`、`overview`、`todos`）。
- 推送 `plan_ready` 后，会话内记录**待执行计划路径**；**仅当**前端在侧栏点击「执行」并在 `/api/agent/chat` 中传入一致的 `execution_plan_path` 时，服务端才进入「计划执行」提示并加载步骤。任意不匹配或跳过界面确认会得到 `error`（`plan_not_approved` / `invalid_plan`）。
- 侧栏「取消」会发送 `clear_pending_plan_path`，清除待执行状态。

## 组卷导出一致性

- 工具的 `exam.export_paper` 与组卷页导出共享 `build.yaml` 备份/恢复、`mark_exported`、失败草稿（`save_exam_workspace_after_export_failure`）等逻辑；若检测到「相同试卷说明与学科」已被**其他**目录占用，须传 `allow_replace_conflicting_export: true` 才继续，避免静默覆盖。

## 子任务（run_subtask）

- 子任务**不挂载**主会话的 `SessionState`，避免计划模式、聚焦域、任务步骤被并行推理污染。
- 子任务工具集排除会话类与项目落盘类工具；Vivace 下仍对高危工具走快模型复核（未配置快模型时可能要求回到主对话）。

## 记忆写入

- 仅在满足启发式「有教学/任务价值」的问答后自动追加 `analysis_history.md` / `session_digest.md` 并尝试更新索引；索引条目的「相似替换」默认阈值较高（约 0.92），减少误并条目。
- 主题文件过长时会裁剪并保留尾部条目。

## 回合结束与确认

- 需要教师确认时，在 `confirm_needed` 之后通常会有 `done`，且带 `awaiting_confirmation: true`，表示流已结束、等待用户在侧栏点确认而非仍在生成。
- 连续工具轮次耗尽时会推送 `error`（`max_rounds`）并写入一条助手说明，提示用户发送「继续」。

## 验证命令（开发者）

```bash
pixi run pytest tests/test_agent_layer.py tests/test_agent_plan_and_subagent.py tests/test_agent_exam_export.py tests/test_user_llm_overrides.py -v
```
