# SolEdu 打包执行清单（Pixi 版）

> 目标：在全新 Windows 机器上，仅安装 `pixi` 后即可完成环境准备与桌面安装包构建，避免依赖个人电脑的全局环境。

## 0) 预期结果

- [ ] 构建命令全部通过 `pixi` 进入项目内环境执行
- [ ] Python / Node / Rust 工具链不从系统全局路径取
- [ ] 打包产物位于 `src-tauri\target\release\bundle\msi\`

---

## 1) 首次准备（全新机器）

### 1.1 安装 pixi

- 官方安装文档：https://pixi.sh/latest/
- Windows PowerShell 示例（管理员或普通用户均可）：

```powershell
powershell -ExecutionPolicy ByPass -c "iwr -useb https://pixi.sh/install.ps1 | iex"
```

### 1.2 克隆项目并进入仓库根目录

```powershell
git clone https://github.com/zijian-optics/SolaireEPDA.git
cd SolaireEPDA
```

---

## 2) 一键执行（推荐）

> 下列命令会先初始化项目内依赖，再执行打包。

```powershell
.\scripts\build-with-pixi.ps1
```

---

## 3) 分步执行（排障时使用）

### 3.1 检查项目内工具链

```powershell
pixi run doctor
```

### 3.2 安装项目依赖

```powershell
pixi install
pixi run bootstrap
```

### 3.3 执行桌面打包

```powershell
pixi run build-desktop
```

---

## 4) 可选开关（与旧脚本保持一致）

```powershell
# 跳过 Rust 编译
.\scripts\build-with-pixi.ps1 -SkipRust

# 跳过嵌入式 Python
.\scripts\build-with-pixi.ps1 -SkipPythonRuntime

# 跳过 Tauri 打包
.\scripts\build-with-pixi.ps1 -SkipTauri
```

---

## 5) 验收清单

- [ ] `pixi run doctor` 能输出 `python/node/cargo/rustc/maturin` 版本
- [ ] `pixi run build-desktop` 无缺包错误
- [ ] 产物目录存在 `.msi`
- [ ] 新机器安装后应用可启动，并能拉起本地服务

---

## 6) 常见问题

### Q1：为什么还要运行 `pixi run bootstrap`？

因为前端依赖（`npm install` / `npm ci`）和 Python 项目依赖（`pip install -e .`）需要在项目内环境完成一次初始化，后续构建才能完全复现。

### Q2：怎样确认没有误用系统环境？

请始终使用：

- `.\scripts\build-with-pixi.ps1`（推荐）
- 或 `pixi run ...` 前缀命令

不要直接在裸终端运行 `npm` / `python` / `cargo` 构建命令。
