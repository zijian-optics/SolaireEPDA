# SolEdu 开发者 Wiki 索引

维护约定与目录说明见 [本 wiki 的 Schema（README）](README.md)。检索时优先读本页，再进入下列专题或对外文档。

## 总览

- [架构总览](architecture/overview.md) — 多技术栈布局、主入口与用户项目目录概念；含桌面 Web 壳布局与保存快捷键说明。
- [目录与锚点文件速查](architecture/file-map.md) — 顶层目录职责与关键配置文件/入口路径。

## 专题模块

- [开发环境与验证命令](modules/dev-environment.md) — Pixi 初始化、`dev` / `test` / `build-desktop` 等常用命令。
- [桌面启动与握手](modules/desktop-startup.md) — 嵌入式 Python 与 `tauri dev` 下的端口、健康检查与前端事件。
- [考试目录与接口（exams）](modules/exams-storage.md) — `exams/<标签段>/<学科段>/` 落盘与 `/api/exams` 硬切换说明。
- [助手模型与本机/项目配置](modules/agent-user-settings.md) — 环境变量、用户目录与项目内 `llm_overrides` 的合并顺序与 `persist_scope`。
- [智能助手层行为约定（agent_layer）](modules/agent-layer.md) — 上下文、计划审批、导出一致性、子任务与记忆策略摘要。

## 对外开发者文档（仓库 `docs/`）

- [智能体 HTTP API 说明](../docs/api/agent.md) — 与 Agent 相关的接口约定（若路径随仓库调整，以 `docs/` 内实际文件为准）。
- [学情分析 API](../docs/api/edu-analysis.md) — 学情分析相关接口文档。
- [桌面版构建](../docs/desktop-build.md) — 打包流程与常见问题。
- [PrimeBrush 重命名迁移](../docs/migrations/primebrush-rename.md) — 历史迁移说明。

## 其他

- [LLM Wiki 模式理念](llm_wiki.md) — 通用「持久 wiki + 索引 + 日志」思路，非本仓库专属操作手册。
