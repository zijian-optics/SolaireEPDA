# 目录与锚点文件速查

本文档为 **目录职责 + 关键入口** 两层索引，不罗列每个源文件；重构后若入口或顶层布局变化，请同步更新本页与 [index.md](../index.md)。

## 顶层与重要目录

| 路径 | 职责（一句话） |
|------|----------------|
| `src/solaire/` | Python 业务与 API 包；`web` 子包承载 FastAPI 应用与静态/模板资源。 |
| `web/` | 浏览器与 Tauri WebView 共用前端工程（Vite + React）。 |
| `src-tauri/` | 桌面壳：Rust、`tauri.conf.json`、能力与 Windows 安装包产物目录等。 |
| `primebrush-rs/` | 声明式绘图相关 Rust crate 与 WASM 构建。 |
| `tests/` | 仓库级 pytest 用例。 |
| `scripts/` | PowerShell 等脚本（开发时拉起前后端、发布构建等）。 |
| `docs/` | 开发者文档（API、桌面构建、迁移记录）。 |
| `wiki/` | Agent 导向 wiki（本库）。 |
| `examples/` | 示例项目与样例输出，便于对照业务数据布局。 |

## 锚点文件（配置与入口）

| 路径 | 作用 |
|------|------|
| `pixi.toml` | Pixi 工作区：Python/Node/Rust 版本、任务（`bootstrap`、`dev`、`test`、`dev-backend` 等）。 |
| `pyproject.toml` | Python 包元数据、依赖、`console_scripts` 入口（`solaire-web`、`solaire-desktop` 等）。 |
| `package.json`（仓库根） | Tauri CLI 脚本（`tauri:dev`、`tauri:build`）。 |
| `web/package.json` | 前端依赖与脚本（`dev`、`build`、`test`）。 |
| `web/index.html` / `web/src/main.tsx` | 前端 HTML 入口与 React 挂载点。 |
| `src/solaire/web/app.py` | FastAPI 应用：路由注册、中间件、核心业务 API 聚合入口。 |
| `src/solaire/web/extension_registry.py` | 可选扩展检测与 `resolve_exe`（本页保存路径优先于 PATH）；与编译/文档/Mermaid 管线共用。 |
| `src/solaire/web/extension_preferences.py` | `host_extension_paths.json` 持久化（应用数据目录）。 |
| `src/solaire/web/__main__.py` | `python -m solaire.web` / `solaire-web` 命令行入口。 |
| `src/solaire/desktop_entry.py` | 桌面嵌入式 Python 进程入口（端口握手等）。 |
| `src-tauri/src/main.rs` | Tauri 后端：子进程、健康检查、`backend-ready` / `backend-failed` 等。 |
| `src-tauri/tauri.conf.json` | 桌面应用标识、devUrl、beforeDevCommand 等。 |
| `src-tauri/capabilities/default.json` | 前端可调用的 Tauri 能力（如事件监听）。 |
| `src/solaire/web/assets/help_docs/` | 应用内用户手册 Markdown 与清单（随包分发）。 |

## 深入阅读

- 架构关系与业务目录概念：[overview.md](overview.md)
- 桌面握手与健康检查：[../modules/desktop-startup.md](../modules/desktop-startup.md)
- 开发命令一览：[../modules/dev-environment.md](../modules/dev-environment.md)
