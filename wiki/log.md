# 变更日志（开发者）

## [2026-04-11] 桌面开发握手 | 超时弹窗与 200 日志的解读

**改动摘要**：在 `wiki/modules/desktop-startup.md` 补充说明：`/api/health` 与业务 200 的差异、`solaire-desktop-python.log` 尾日志在开发模式下可能不代表本次握手、以及 `sidecar_dev_hint` 文案含义。

**验证命令**：代码审阅（`src-tauri/src/main.rs` 中 `wait_for_health`、`append_log_context`、`sidecar_dev_hint`）。

**结果要点**：事件驱动流程仍成立；未就绪来自 Rust 侧 30s 内健康检查未满足，与弹窗内附带的尾日志不一定同一时刻。

## [2026-04-11] 桌面开发握手 | 开发模式健康等待 120s 与 no_proxy

**改动摘要**：`tauri dev` 无嵌入式分支将 `wait_for_health` 最长等待由 30s 改为默认 **120s**（与前端壳一致），支持 `SOLAIRE_BACKEND_HEALTH_WAIT_SECS`（10～600）；`reqwest` 客户端增加 `no_proxy()`。

**验证命令**：`cd src-tauri && cargo test`。

**结果要点**：缓解冷启动导入超过 30s 时「后端已可用但 Rust 已超时」的假失败。

## [2026-04-10] 帮助手册路径 | 包内资源与 `/api/help/index`

**改动摘要**：将 `src/solaire_doc/` 迁入 `src/solaire/web/assets/help_docs/`；`pyproject.toml` 的 `package-data` 纳入手册文件；`help_docs.get_solaire_doc_dir()` 改为相对 `help_docs.py` 的包内路径（并保留 `SOLAIRE_HELP_DOC_ROOT` 与旧 `src/solaire_doc` 兜底）。更新 README、内部引用与 wiki。

**验证命令**：`pixi run test`（或 `pytest tests/test_help_api.py`）。

**结果要点**：未设置覆盖变量时，`GET /api/help/index` 从包内清单加载，避免嵌入式 `site-packages` 下错误拼接 `src/solaire_doc` 导致 500。

## [2026-04-10] 桌面启动架构 | 动态端口与事件握手

**改动摘要**：嵌入式后端改为 `--port 0` + 首行 `SOLAIRE_LISTEN_PORT` 握手；移除 8000–8010 端口扫描；前端以 `backend-ready` / `backend-failed` 与 `get_backend_port`（非阻塞）完成握手；新增 `BootstrapShell` 首屏。

**验证命令**：

- `cd src-tauri && cargo test`
- `cd web && npm run build && npm test`

**结果要点**：Rust 单测与前端构建、Vitest 均通过。
