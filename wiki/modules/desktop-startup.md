# 桌面启动与握手

## 发布包（嵌入式 Python）

- 应用内手册 Markdown 与 `help-manifest.json` 随 Python 包 `solaire.web` 分发（`src/solaire/web/assets/help_docs/`），`pip install` 后由 `solaire.web.help_docs` 解析路径；调试可用环境变量 `SOLAIRE_HELP_DOC_ROOT` 指向自定义目录。
- Python 入口 `solaire.desktop_entry` 使用 `--port 0`，由操作系统分配空闲端口；首行 stdout 输出 `SOLAIRE_LISTEN_PORT=<端口>`，与 Rust 侧常量一致。
- Rust 读取握手行后，将后续 stdout 追加写入 `%TEMP%\solaire-desktop-python.log`，再对该端口执行 `/api/health`（校验 `product == sol_edu`）。
- 成功：`AppState.backend_port` 写入端口 → `emit("backend-ready", { port })`；失败：`emit("backend-failed", { message })`（文案已本地化）。

## 开发模式（`tauri dev`）

- `scripts/dev-desktop.ps1` 固定拉起 `127.0.0.1:8000`；Tauri 无嵌入式 Python 时仅对该端口做健康检查，同样广播 `backend-ready` / `backend-failed`。

## 前端

- `get_backend_port`：**非阻塞**，端口未就绪时返回错误字符串（非轮询等待）。
- 壳内通过 `@tauri-apps/api/event` 订阅 `backend-ready` / `backend-failed`，并对 `get_backend_port` 做一次调用以消除「事件早于 listen」的竞态。
- 入口组件 `BootstrapShell` 在握手完成前展示「正在连接本地服务…」，避免白屏。

## 权限

- `src-tauri/capabilities/default.json` 需包含 `core:event:allow-listen`（供前端 `listen`）。
