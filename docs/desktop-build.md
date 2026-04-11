# 桌面版构建指南（Windows）

## 快速开始

### 前置条件

- [Pixi](https://pixi.sh/latest/)（统一管理 Python / Node / Rust 工具链）
- **Git**
- **Visual Studio Build Tools**（含 MSVC，供 Rust 链接原生代码）
- 构建期间需可访问：`python.org`、`bootstrap.pypa.io`、`pypi.org`、`registry.npmjs.org`（公司网络若拦截，需放行或配代理）

### 初始化（首次执行一次）

```powershell
git clone https://github.com/zijian-optics/SolaireEPDA.git
cd SolaireEPDA
pixi install
pixi run bootstrap
```

### 开发模式

```powershell
pixi run dev
```

启动后访问 `http://127.0.0.1:5173`（前端），后端 API 运行于 `http://127.0.0.1:8000`。

### 桌面版打包

```powershell
pixi run build-desktop
```

产物位于 `src-tauri\target\release\bundle\msi\`。

---

## 开发模式详解

`pixi run dev` 等同于 `npm run tauri:dev`，Tauri 会自动执行 `scripts/dev-desktop.ps1`，该脚本负责：

1. 若 `127.0.0.1:8000` 上仍有监听进程则尝试结束，避免残留占用
2. 后台启动 Uvicorn（`127.0.0.1:8000`，带 `--reload`）
3. 前台启动 Vite（`127.0.0.1:5173`）；Tauri 在应用就绪后对 `8000` 做 `/api/health` 检查，并通过 `backend-ready` 事件通知前端

开发模式使用当前源码的 Python 环境，**不**使用 `src-tauri/runtime/python` 内的嵌入式解释器。

此外，开发模式与发布构建在窗口行为上有一处刻意差异：

- `tauri dev`：不启用单实例拦截；关闭主窗体时直接退出，便于热重载后重新拉起新实例
- 发布构建：保留单实例限制；关闭主窗体时隐藏到系统托盘，符合正式版桌面应用使用习惯

---

## 打包详解

`pixi run build-desktop` 内部按序执行：

1. （若已安装 `maturin`）编译 `primebrush-rs` PyO3 扩展
2. 前端：`npm ci` → `npm run build`
3. `scripts/stage-python-runtime.ps1`：下载 Windows embeddable Python，启用 `import site`，安装 pip，执行 `pip install .` 安装本仓库及全部依赖
4. 若本机缺少 WiX 缓存，自动执行 `scripts/prepare-wix-tools.ps1` 预下载 WiX Toolset
5. `npm run tauri:build` 产出 MSI 安装包

> 打包前**必须**成功完成 `stage-python-runtime.ps1`，否则安装包内嵌入式 Python 不完整，本地服务无法启动。

发布包运行时，本地服务端口由操作系统动态分配（非固定 `8000`）；Rust 解析子进程首行 `SOLAIRE_LISTEN_PORT=<端口>` 后再做健康检查。排查时可查看 `%TEMP%\solaire-desktop-python.log`（含 Uvicorn 输出）。

---

## 集成验证

安装生成的 MSI 后：

1. 若启动长时间无响应，查看 `%TEMP%\solaire-desktop-python.log`（嵌入式 Python stderr，可定位 import 失败或端口占用问题）
2. 确认无额外控制台窗口；应用最小化后在系统托盘可见
3. 在欢迎页使用「新建项目」或「打开项目」后，确认各功能页面可正常使用
4. 关闭再重开，「最近打开」中应出现该项目
5. PDF 导出依赖本机安装的 TeX 发行版（MiKTeX 或 TeX Live）；未安装时组卷页会显示引导

---

## 常见问题

### WiX 下载超时（`timeout: global`）

Tauri 打包时需从 GitHub 下载 WiX Toolset。网络受限时，预先手动执行：

```powershell
.\scripts\prepare-wix-tools.ps1
```

或浏览器下载 `wix314-binaries.zip` 后解压到 `%LOCALAPPDATA%\cache\tauri\WixTools314`（目录内须直接可见 `candle.exe`、`light.exe`）。

### 嵌入式 Python 压缩包损坏

报错 `End of Central Directory record could not be found` 时，脚本会自动重新下载。若仍失败，手动清除缓存后重试：

```powershell
Remove-Item -Force .\.cache\python-embed\python-3.12.7-embed-amd64.zip
pixi run build-desktop
```

### 端口 8000 被占用（开发模式）

`dev-desktop.ps1` 启动时若检测到 8000 端口已被**非** Solaire 进程占用，会报错退出并提示占用进程。请先停止该进程再重试。

### `tauri dev` 改完 `src-tauri` 后看起来“没有反应”

先确认当前终端中是否出现以下日志：

- `Info File src-tauri\src\main.rs changed. Rebuilding application...`
- `Running target\debug\solaire-desktop.exe`
- 后端日志里出现 `GET /api/health HTTP/1.1 200 OK`

若以上日志都出现，通常表示热重载链路正常，新的桌面实例已经重新启动。

若仍未看到主窗口，可优先检查：

1. 终端里是否还有旧的 `solaire-desktop.exe` 残留
2. `127.0.0.1:8000` 的本地后端是否已成功响应 `/api/health`
3. `scripts/dev-desktop.ps1` 是否正常拉起了 Vite 与 Uvicorn

### 调试嵌入式运行时

若需在 `pixi run dev` 中调试与安装包一致的嵌入式解释器，先执行：

```powershell
.\scripts\stage-python-runtime.ps1
```

再设置环境变量 `SOLAIRE_USE_SIDECAR=1` 后启动 `pixi run dev`。
