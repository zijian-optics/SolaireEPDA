# 开发环境与验证命令速查

首次克隆后需安装 Pixi，并在仓库根执行依赖初始化。详细环境要求见仓库根 [README.md](../../README.md)（TeX、MSVC 等）。

## 首次初始化

```powershell
pixi install
pixi run bootstrap
```

`bootstrap` 会安装 Python 可编辑包、根目录 npm 依赖与 `web/` 下前端依赖（首次可能需数分钟）。

## 日常开发

| 命令 | 说明 |
|------|------|
| `pixi run dev` | 一键启动：后端（默认 `127.0.0.1:8000`）+ 前端 Vite（`localhost:5173`）+ `tauri dev`。串联由 Tauri 的 `beforeDevCommand`（如 `scripts/dev-desktop.ps1`）完成。 |
| `pixi run dev-backend` | 仅后端：`uvicorn solaire.web.app:app --app-dir src --reload`。 |
| `pixi run dev-frontend` | 仅前端开发服务器。 |

**注意**：已运行 `pixi run dev` 时不要重复占用 8000/5173；单独调试后端或前端时使用后两行之一即可。

### 仅用 `start-web.ps1` / `start-web.sh` 时

脚本必须为 Uvicorn 传入 **`--app-dir <仓库>/src`**（与 `pixi run dev-backend`、`scripts/dev-desktop.ps1` 一致）。若省略，Python 可能从 **site-packages** 加载旧版 `solaire`，表现为草稿目录仍为 **UUID**、接口行为与仓库源码不一致。

自检：浏览器或 `curl` 访问 `http://127.0.0.1:8000/api/health`，JSON 中应有 **`exam_workspace_layout":"two_level"`**。若无该字段，说明当前监听的后端不是本仓库当前实现。

## 构建与清理

| 命令 | 说明 |
|------|------|
| `pixi run build` | 在 `web/` 下执行生产构建（前端静态资源）。 |
| `pixi run clean` | 清理常见构建产物（如 `web/dist`、部分 Tauri bundle 目录），详见 `pixi.toml`。 |
| `pixi run build-desktop` | 桌面安装包构建（PowerShell 脚本）；产物与排错见 [docs/desktop-build.md](../../docs/desktop-build.md)。 |

## 测试与类型检查

| 命令 | 说明 |
|------|------|
| `pixi run test` | 仓库根 `pytest tests`。 |
| `pixi run test-web` | `web/` 下前端测试（如 Vitest）。 |
| `pixi run typecheck` | `web/` 下 `tsc --noEmit`。 |

## 相关专题

- 桌面壳与后端握手、超时与环境变量：[桌面启动与握手](desktop-startup.md)
- 架构与入口文件：[../architecture/file-map.md](../architecture/file-map.md)
