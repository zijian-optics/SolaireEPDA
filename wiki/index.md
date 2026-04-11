# SolEdu 开发者 Wiki 索引

维护约定与目录说明见 [本 wiki 的 Schema（README）](README.md)。检索时优先读本页，再进入下列专题或对外文档。

## 总览

- [架构总览](architecture/overview.md) — 多技术栈布局、主入口与用户项目目录概念。
- [目录与锚点文件速查](architecture/file-map.md) — 顶层目录职责与关键配置文件/入口路径。

## 专题模块

- [开发环境与验证命令](modules/dev-environment.md) — Pixi 初始化、`dev` / `test` / `build-desktop` 等常用命令。
- [桌面启动与握手](modules/desktop-startup.md) — 嵌入式 Python 与 `tauri dev` 下的端口、健康检查与前端事件。

## 对外开发者文档（仓库 `docs/`）

- [智能体 HTTP API 说明](../docs/api/agent.md) — 与 Agent 相关的接口约定（若路径随仓库调整，以 `docs/` 内实际文件为准）。
- [学情分析 API](../docs/api/edu-analysis.md) — 学情分析相关接口文档。
- [桌面版构建](../docs/desktop-build.md) — 打包流程与常见问题。
- [PrimeBrush 重命名迁移](../docs/migrations/primebrush-rename.md) — 历史迁移说明。

## 其他

- [LLM Wiki 模式理念](llm_wiki.md) — 通用「持久 wiki + 索引 + 日志」思路，非本仓库专属操作手册。
