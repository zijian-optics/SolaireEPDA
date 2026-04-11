# 仓库架构总览

**SolEdu（SolaireEPDA）** 是单体多技术栈仓库：Python 后端（FastAPI）、React/Vite 前端、Tauri 桌面壳，以及可选的 Rust 绘图相关 crate。业务上覆盖组卷、题库、知识图谱、学情分析与智能助手等模块。

## 技术栈与顶层目录

| 目录 | 说明 |
|------|------|
| `src/solaire/` | Python 包根目录（可编辑安装 `pip install -e .`）。含 `web`（HTTP API）、`exam_compiler`、`agent_layer`、PrimeBrush 等子包。 |
| `web/` | 前端：TypeScript + React + Vite；开发时默认 `localhost:5173`。 |
| `src-tauri/` | Tauri v2 桌面壳：Rust 侧进程管理、与本地后端握手、事件广播。 |
| `primebrush-rs/` | 与教育绘图相关的 Rust 工作区（含 WASM 等），与 Python 侧 PrimeBrush 协同。 |
| `tests/` | Python 端测试（pytest）。 |
| `scripts/` | 构建与开发辅助脚本（如桌面开发前置 `dev-desktop.ps1`）。 |
| `docs/` | 面向开发者的补充文档（API 说明、桌面构建、迁移说明等）。 |
| `examples/` | 示例项目与样例数据。 |
| `wiki/` | 本开发者 wiki（索引、日志、架构与专题页）。 |

## 主入口与常用命令

- **统一开发**：`pixi run dev` — 由 Pixi 任务串联后端（Uvicorn `127.0.0.1:8000`）、前端（Vite）与 `tauri dev`。详见 [开发环境速查](../modules/dev-environment.md)。
- **仅后端**：`pixi run dev-backend` — `uvicorn solaire.web.app:app`，`--app-dir src`。
- **Python 包脚本**（见 `pyproject.toml` `[project.scripts]`）：如 `solaire-web`、`solaire-desktop`、`solaire-exam`、`primebrush` 等。

根目录 `package.json` 主要提供 **Tauri CLI**（`npm run tauri:dev` / `tauri:build`），与 `pixi run dev` 所用逻辑一致。

## 用户项目内常见路径（跨模块约定）

用户在磁盘上打开的是「教学项目」目录，而非本仓库根。维护后端/桌面时常见相对概念：

- **`.solaire/`**：项目级配置与状态（如智能体安全模式、草稿、上传临时目录、计划模式落盘路径等），具体子路径以代码与包内说明为准。
- **`resource/`、`result/`**：与题库资源、考试结果、学情分析产出等相关的业务目录命名在功能模块与示例项目中出现；以当前打开项目与 API 契约为准。

细则或变更见 `.cursor/rules/llm-wiki-scope.mdc` 与专题页 [桌面启动与握手](../modules/desktop-startup.md)。

## 桌面端 Web 壳（`web/`）布局要点

绑定教学项目后的主界面大致为：**顶栏菜单**（文件 / 视图）→ **多功能工具栏**（随当前视图变化）→ **左侧导航** + **中间工作区** + **右侧智能助手浮层**（不挤压主内容宽度）。未绑定项目时进入欢迎页（软件介绍、项目、模型服务、扩展组件等）。

- **保存**：`Ctrl+S`（macOS 为 `⌘+S`）与菜单「文件 → 保存」会触发当前视图的保存逻辑（如题库/模板有未保存修改时写入；知识图谱在选中节点且表单有改动时提交；偏好设置页在「模型」页且可持久化时保存模型配置）。组卷等以草稿/导出为主流程的视图需仍在各自界面操作保存或导出。

## 与其他文档的分工

- **用户安装与功能列表**：仓库根 [README.md](../../README.md)
- **HTTP / 桌面构建细节**：[docs/](../../docs/) 下各篇
- **路径级速查**：[file-map.md](file-map.md)
