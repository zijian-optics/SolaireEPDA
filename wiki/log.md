# 变更日志（开发者）

## [2026-04-11] LLM Wiki 落地 | Schema、索引与路径速查

**改动摘要**：新增 `wiki/README.md`（Schema 与维护约定）；新建 `wiki/architecture/overview.md`、`wiki/architecture/file-map.md`；新建 `wiki/modules/dev-environment.md`；扩展 `wiki/index.md`（总览、专题、`docs/` 链接）；修正 `wiki/modules/desktop-startup.md` 中健康检查超时描述与默认 120s 一致；根目录新增 `AGENTS.md` 指向 wiki 入口。

**验证命令**：对新增/修改的 Markdown 做路径与链接自检（`docs/api/*.md`、`wiki/**` 相对链接）。

**结果要点**：规则中引用的 `wiki/README.md` 已存在；索引可导向架构、file-map、开发环境、桌面专题与对外文档。

## [2026-04-11] LaTeX对齐
**新建文件**
`web/src/lib/contentTokenizer.ts`内联了 KaTeX splitAtDelimiters 的状态机算法，统一解析：

- $...$ 行内公式 → inlineMath token
- $$...$$ / \[...\] / AMS 环境（align/cases/gather 等）→ displayMath token
- Mermaid 围栏、图片占位符先转 sentinel 再还原，不会干扰公式解析
- 允许 $ 跨行，与真实 TeX 行为一致
`web/src/lib/latexCanon.ts` MathLive 语义宏标准化：\imaginaryI → \mathrm{i}，\exponentialE → \mathrm{e} 等，在公式写入存储前调用，消除 XeLaTeX 不认识的命令。

`web/src/lib/katexRender.ts` 统一 KaTeX 渲染器：注入模板自定义宏（\dlim、\dint、\e、\i、\arccot），使用 strict: "warn" 收集 warning，throwOnError: false 降级而非抛错。

`web/src/lib/mathLint.ts` 前端分级校验：正文裸 % → error，裸 _/^ → warning，$ 定界符不平衡 → error。利用 tokenizer 只扫描 text token，公式内的下划线/上标不误报。

**重构文件**
- `KatexText.tsx`：buildKatexHtml 现支持 $$ 显示公式，全面替换旧的 split("$") 奇偶法
- `ContentWithPrimeBrush.tsx`：改用统一分词器，删除手动 VISUAL_EMBED_RE 正则逻辑
- `LatexRichTextField.tsx`：编辑器新增 displayMath widget（块级居中），底部实时显示 lint 提示条（红色 error / 黄色 warning）
- `MathInsertOverlay.tsx`：确认公式前自动 canonicalize
**验证命令**: `npx tsc --noEmit` → 零报错 `npx vitest run` → 44 个测试全部通过

## [2026-04-11] BankWorkspace | insertSnippet 与 Strict Mode 兼容

**改动摘要**：`insertSnippet` 改为接收 `(snippet, kind, saved)`，由调用方在 `setDetail` 外读出 `embedKindRef` / `embedSelectionRef` 后传入；`setDetail` 的 updater 内不再读写上述 ref。避免 React 18 Strict Mode 双次调用 updater 时第二次读空 ref 导致公式/Mermaid/图片插入在 dev 下丢失（生产构建无双次调用故不易复现）。

**验证命令**：`cd web && npx tsc --noEmit`。

**结果要点**：TypeScript 检查通过。

## [2026-04-11] LatexRichTextField | 清理未使用代码以通过 tsc

**改动摘要**：删除未引用的 `ANY_WIDGET_SELECTOR` 常量，以及从未调用的 `setCaretFromSerializedOffset`（与 `getSerializedCaretOffset` 对称的光标还原逻辑；若日后需要从隐藏 textarea 同步选区回可视化编辑器，可再实现并接入）。

**验证命令**：`cd web && npm run build`。

**结果要点**：`tsc -b` 与 `vite build` 通过。

## [2026-04-11] LatexRichTextField | 类 Overleaf 可视化编辑器（公式 + Mermaid + 图片）

**改动摘要**：完整重写 `web/src/components/LatexRichTextField.tsx`，实现类似 Overleaf Visual Editor 的体验，统一处理三种嵌入类型：

- **统一正则分词器**：`TOKEN_RE` 一次匹配 `$latex$`（行内公式）、`` ```mermaid\n…\n``` ``（Mermaid 围栏）和 `:::*_IMG:path:::`（图片标记），未配对的 `$` 不再破坏渲染。
- **行内公式**：`$` 键 / `Ctrl+M` 即刻创建公式节点并弹出 MathLive 编辑器；单击已有公式编辑；工具栏快捷模板（分数、根号、上下标）与符号面板。
- **Mermaid 图表**：内容中的 mermaid 围栏块渲染为可视化卡片（异步 mermaid.js SVG 预览）；单击打开内联编辑弹窗（源码 + 实时预览双栏布局）；工具栏「图表」按钮委托父组件打开完整 MermaidEditorModal。
- **图片嵌入**：`:::*_IMG:path:::` 标记渲染为缩略图卡片；单击打开预览弹窗（查看 / 删除）；工具栏「图片」按钮委托父组件触发文件选择 + 上传。
- **源码/可视化切换**：两种模式一键切换，源码模式下所有标记均以原始文本显示。
- **Props 扩展**：新增 `onRequestMermaid`、`onRequestImage`、`busy`，父组件传入回调即可在工具栏显示对应按钮。

同步更新 `BankQuestionEditorPanel.tsx`：content 字段的外部「插入公式 / 图表 / 图片」按钮全部整合进组件内置工具栏。

**验证命令**：`cd web && npx tsc --noEmit && npx vite build`。

**结果要点**：TypeScript 与 Vite 构建均通过，无类型错误。

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