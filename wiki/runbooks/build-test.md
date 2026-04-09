# 运行手册：构建、测试与基线

## 环境

- 推荐使用 **Pixi** 管理 Python / Node / Rust（见根目录 `README.md`）。
- PDF 导出需本机 TeX（`latexmk`、`xelatex` 在 PATH）。

## 依赖初始化

```powershell
pixi install
pixi run bootstrap
```

## 开发（全栈桌面）

```powershell
pixi run dev
```

- 后端：约 `http://127.0.0.1:8000`，带 reload
- 前端：Vite `http://localhost:5173`（与 `tauri.conf.json` 中 `devUrl` 一致）

**单独调试**（避免与 `pixi run dev` 同时占端口）：

- `pixi run dev-backend`
- `pixi run dev-frontend`

## 清理与前端生产构建

```powershell
pixi run clean
pixi run build
```

## 测试与类型检查

| 命令 | 说明 |
|------|------|
| `pixi run test` | Python 测试 |
| `pixi run test-web` | 前端单测 |
| `pixi run typecheck` | TypeScript 类型检查 |

等价（dev-workspace 直接写法）：`pytest`、`npm test`（在对应环境中执行）。

## 学情分析基线（Windows）

```powershell
scripts/check_edu_analysis_baseline.ps1
```

## 桌面打包

```powershell
pixi run build-desktop
```

产物与说明见 `docs/desktop-build.md`。
