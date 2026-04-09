# 模块：桌面壳（Tauri）

## 主目录

- `src-tauri/`：Rust + Tauri 入口（如 `src/main.rs`）
- `src-tauri/tauri.conf.json`：开发 URL、打包等配置

## 行为摘要

- 开发模式：`pixi run dev` 通过 `scripts/dev-desktop.ps1` 等与后端、Vite 串联；后端端口与健康检查逻辑见 `main.rs` 等。
- 嵌入式 Python 运行时路径：`src-tauri/runtime/python/`（大文件由脚本生成，多数不提交）

## 相关

- [web-app.md](web-app.md)
- [runbooks/build-test.md](../runbooks/build-test.md)
- 根目录 `README.md` 与 `docs/desktop-build.md`
