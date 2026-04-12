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

## [2026-04-12] 组卷 | 从历史复制需填考试标签

**改动摘要**：`ComposeWorkspace` 在「从历史试卷复制」模式下增加考试标签输入、只读展示所选历史试卷的学科；`POST /api/exam/drafts/from-result/{id}` 请求体发送 `{ export_label }`。内嵌帮助 `http-api-overview.md` 中两条 `from-result` 接口说明已同步为必填 `export_label`、学科沿用源导出。

**验证命令**：`cd web && npm run build`。

**结果要点**：`tsc -b` 与 Vite 生产构建通过。

## [2026-04-12] 组卷 | 统一 exams 单目录并移除草稿兼容 API

**改动摘要**：删除 `/api/exam/drafts*` 与 `GET /api/results/{id}/compose`；组卷仅使用 `GET/POST/PUT/DELETE /api/exams*`；`GET /api/exams` 支持 `status=draft|exported|all`；`POST /api/exam/export` 使用 `exam_ids_to_delete_on_success`；导出失败快照写入 `exams/`（`save_exam_workspace_after_export_failure`）；`DELETE /api/exams/{id}` 同时删除关联 `result/`；`ComposeWorkspace` 单一列表按 `status` 分「草稿/历史」；PDF 使用 `last_export_result_id`；内嵌帮助已更新。

**验证命令**：`cd web && npm run build`；`python -m compileall -q src/solaire/web/app.py src/solaire/web/exam_workspace_service.py`。

**结果要点**：前端构建与 Python 语法检查通过。

## [2026-04-12] 组卷 | 侧栏点击历史试卷载入中间栏

**改动摘要**：新增 `GET /api/results/{exam_id}/compose`（基于 `draft_from_result`，`draft_id` 置空、`source_result_id` 标明来源）；侧栏「历史试卷」点击改为请求该接口并 `applyDraftDocument`，中间栏与右侧 PDF 与所选导出一致。根因并非 `config.json` 草稿/完成状态，而是此前仅切换 `pdfExamId` 未加载 `exam.yaml` 到编辑区。

**验证命令**：`cd web && npm run build`；`python -m compileall src/solaire/web/app.py`（或等价语法检查）。

**结果要点**：前端构建通过；后端新增路由可导入。

## [2026-04-12] exams 单目录硬切换（弃用 result/）

**改动摘要**：考试落盘统一为 `exams/<标签段>/<学科段>/`（`exam.yaml`、`config.json`、PDF、`scores/`）；草稿/历史仅靠 `config.json.status`；移除 `/api/results/*`，成绩与 PDF 能力并入 `/api/exams/{exam_path}/...`，新增 `GET /api/exams/analysis-list`、`POST /api/exams/from-exam/{exam_path}`；`POST /api/exam/export` 返回 `exam_dir`；`export_pdfs` 与 `result_service` 全部读写 `exams/`；内嵌帮助 `http-api-overview.md` 已同步。

**验证命令**：`cd web && npm run build`；`python -m compileall src/solaire/web/app.py src/solaire/web/exam_service.py src/solaire/web/result_service.py src/solaire/web/exam_workspace_service.py`；`pytest tests/test_result_service.py tests/integration/test_results_analysis_baseline.py -q`（按需）。

**结果要点**：构建与 compileall 通过；核心 API 与集成测试路径已更新为 `exams` 双段目录。

## [2026-04-12] exams 落盘路径说明与回归测试

**改动摘要**：确认 `POST /api/exams` 与 `save_exam_workspace` 新建工作区为 `exams/<试卷说明>/<学科>/`；移除 `exam_workspace_service` 未使用的 `uuid` 导入；`ExamSaveDraftBody` 对 `subject`、`export_label` 要求非空（与落盘规则一致）；修正 `ExamExportBody` 中关于 `exam_workspace_id` 的过时描述；新增 `tests/test_exams_create_nested_path.py`；修复 `test_edu_analysis_builtins` 仍使用 `result/` 单层 `exam_id` 的问题；`wiki/modules/exams-storage.md` 补充「成绩批次目录 vs 考试目录」说明。

**验证命令**：`pixi run pytest tests/ -q`。

**结果要点**：全量 `pytest` 通过；磁盘上若仅见「像 UUID 的子目录」，多为 `scores/<批次>/` 或 `.solaire/previews/`，而非考试根目录。

## [2026-04-12] 组卷 | 新建试卷成功提示含试卷目录路径

**改动摘要**：`ComposeWorkspace` 在「创建并进入编辑」或首次「保存更改」成功后，提示文案包含 `exams/<标签段>/<学科段>` 形式的试卷目录，便于与 `scores/` 下批次目录区分；空白试卷创建前校验试卷说明与学科非空。

**验证命令**：`cd web && npm run build`。

**结果要点**：前端构建通过。

## [2026-04-12] 开发模式 | start-web 须 --app-dir src，健康检查暴露试卷目录模型

**改动摘要**：根目录 `start-web.ps1`、`start-web.sh` 为 Uvicorn 增加 `--app-dir src`（及 `--reload`），避免从已安装旧包加载后端导致 `exam_id` 仍为 UUID；`GET /api/health` 增加 `exam_workspace_layout: two_level` 供自检；`wiki/modules/dev-environment.md` 补充说明。

**验证命令**：`curl -s http://127.0.0.1:8000/api/health`（需在仓库根用 `pixi run dev-backend` 或更新后的 `start-web` 启动后端）。

**结果要点**：健康检查可区分「本仓库源码后端」与「旧版已安装包」。

## [2026-04-12] 组卷 | 加载历史导出时 exam_id 以目录为准

**改动摘要**：`load_exam_workspace` 返回的 `exam_id` 固定为路径上的双段标识，不再沿用 `exam.yaml` 内可能存在的旧单段 UUID，避免点击侧栏「历史试卷」后 `currentExamId` 与 PDF/保存仍走旧逻辑；`tests/test_exams_create_nested_path.py` 增加篡改 YAML 后的 GET 回归；`wiki/modules/exams-storage.md` 补充一句。

**验证命令**：`pixi run pytest tests/test_exams_create_nested_path.py -q`。

**结果要点**：测试通过。

## [2026-04-12] 组卷 | 右侧试卷同题型多选移出

**改动摘要**：`RightSelection` 改为 `sectionId + qids[]`；`ComposeWorkspace` 增加 `rightListAnchor` 与 `handleRightPaperSlotClick`（Ctrl/⌘ 切换、Shift 区间内、跨小节 Shift 时仅选中当前槽，不跨题型）；`removeFromRight` 批量过滤并清理 `scoreOverrides`；`zh/en compose.json` 增加 `paperListMultiSelectHint`；`wiki/modules/exams-storage.md` 增加组卷界面交互说明。

**验证命令**：`cd web && npx tsc --noEmit`。

**结果要点**：TypeScript 检查通过。

## [2026-04-12] 模板工作台 | 保存后按模板编号重命名文件

**改动摘要**：新增 `POST /api/templates/rename`（同目录重命名，Windows 支持仅大小写变更）；保存模板时若规范化后的 `template_id` 与当前文件名不一致则先 `PUT` 再重命名，使磁盘文件名与模板编号一致；`TemplateWorkspace` 从 YAML 页保存时从正文解析 `template_id`；冲突 409 时提示 `renameConflict`；`tests/test_template_web_integration.py::test_template_rename_after_save` 覆盖中文文件名场景。

**验证命令**：`pixi run pytest tests/test_template_web_integration.py::test_template_rename_after_save -q`；`cd web && npx tsc --noEmit`。

**结果要点**：测试与 tsc 通过。

## [2026-04-12] 模板工作台 | 重命名并入 PUT（避免 rename 404）

**改动摘要**：`PUT /api/templates/raw` 增加可选 `rename_to`，在同一请求内写完再重命名并返回 `path`；前端保存改为单次 PUT，不再依赖 `POST /api/templates/rename`（避免未升级后端或代理下 404）；`http-api-overview.md` 补充说明；`test_template_rename_after_save` 改为测 PUT+`rename_to`，另增 `test_template_rename_post_endpoint`。

**验证命令**：`pixi run pytest tests/test_template_web_integration.py -q`；`cd web && npx tsc --noEmit`。

**结果要点**：测试与 tsc 通过。

## [2026-04-12] 前端 | 学情分析删除考试后同步组卷列表与状态

**改动摘要**：新增 `web/src/lib/examEvents.ts`（`solaire-exams-changed` 与 `dispatchExamsChanged`）；学情分析删除成功后广播；组卷页订阅并 `refreshExamSummaries`、若 `examId` 命中则清空当前考试、PDF、历史复制源等；组卷侧删除成功后同样广播。

**验证命令**：`cd web && npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 组卷 | 侧栏加载考试被首屏请求覆盖

**改动摘要**：首屏 `Promise.all`（模板/题目/学科）晚返回时不再用默认模板清空 `bySection`（若 `currentExamIdRef` 已有工作区则跳过学科纠正）；默认模板改为独立 `useEffect`（仅 `!currentExamId && !templatePath`）；`templatePath` 变更时 `activeSection` 仅在当前节无效时回落到第一节；`loadExamById` 在应用文档后重置题库筛选并收起筛选区、将当前小节设为 `selected_items` 首节。

**验证命令**：`cd web && npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 组卷 | template_path 含 ../ 导致模板无法匹配

**改动摘要**：`exam_workspace_service._norm_template_path_rel` 去掉前导 `../`，在 `load_exam_workspace`、`list_exam_workspaces` 模板列、`save_exam_workspace`/`_build_exam_doc`、`persist_exam_document`、迁移导入等处统一；前端 `normTemplatePath` 同步。根因：`../templates/foo.yaml` 与 `/api/templates` 返回的 `templates/foo.yaml` 不一致 → `selectedTpl` 为空、保存草稿报「先选模板」、数学卷与历史卷混点时被误认为「学科变 history」（实为另卷或路径问题）。**非**「历史试卷」侧栏文案与「历史」学科名冲突。

**验证命令**：`pixi run pytest tests/test_exams_create_nested_path.py -q`。

**结果要点**：3 passed；新增 `test_norm_template_path_rel_strips_parent_segments`。

## [2026-04-12] 组卷 | 打开试卷后学科下拉不显示 exam 学科

**改动摘要**：`ComposeWorkspace` 增加 `subjectOptionsForSelect`（`subjectOptions` ∪ 当前 `subject` ∪ 对话框 `dlgSubject`），题库筛选与新建试卷学科下拉共用，避免 `value` 无匹配 `option`。

**验证命令**：`cd web && npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 考试工作区 | 空 export_label 时从目录回填

**改动摘要**：`exam_workspace_service._fill_identity_from_exam_path_fields`：在 `load_exam_workspace` 与 `list_exam_workspaces` 中，若 `export_label` 或 `subject` 为空，用 `exam_id` 的两段路径回填。

**验证命令**：`pixi run pytest tests/test_exams_create_nested_path.py -q`。

**结果要点**：4 passed；新增 `test_fill_identity_from_exam_path_fields`。

## [2026-04-12] 题库 | 移除 BankWorkspace 路径说明文案

**改动摘要**：删除 `BankWorkspace` 标题下灰色说明段落；移除 `zh`/`en` 中仅用于该段的 `structureHint`、`structurePath`、`structureHintTail` 文案键。

**验证命令**：`cd web && npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 前端 | 顶栏工具栏切换页刷新与占位高度

**改动摘要**：根因：组卷 `ComposeRoute` 在非组卷页仍挂载，`ComposeWorkspace` 继续 `setToolBar` 会覆盖当前页工具栏。修复：`ComposeRoute`/`ComposeWorkspace` 增加 `toolBarActive={page === "compose"}`，非激活时不再注册工具栏并在 `toolBarActive` 为 false 时 `clearToolBar`；`ToolBar` 在 `left`/`right` 均为空时仍渲染 `min-h-[2.5rem]` 占位条，避免高度跳动。

**验证命令**：`cd web; npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 前端 | 主导航侧栏略缩窄

**改动摘要**：`App.tsx` 已绑定项目时的左侧 `aside` 宽度由 `w-[4.25rem]` 改为 `w-16`（4rem）。

**验证命令**：`cd web; npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 题库 | 列表项题号换行与排版

**改动摘要**：`BankWorkspace` 左侧题目列表：题型/题组标签与全限定题号同一行 `flex` 排列，题号 `min-w-0 flex-1 break-all` 可换行；`KatexPlainPreview` 置于下一行独立块；按钮增加 `min-w-0` 以利窄栏收缩。

**验证命令**：`cd web; npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 题库 | 导入并入顶栏「导入题库」

**改动摘要**：`BankWorkspace` 侧栏「导入题目」`details` 移除；顶栏原「选择文件并导入」改为「导入题库」下拉（展示 `importSummaryHint`、格式说明、导入到科目/题集、选择文件、粘贴导入）；与筛选/新建互斥；文件或粘贴导入成功后收起；`pickAndImport` 键删除，新增 `importToolbar`、`importChooseFile`；空列表提示改为指向顶栏。

**验证命令**：`cd web; npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 题库 | 新建题目并入顶栏下拉

**改动摘要**：`BankWorkspace` 删除侧栏 `details#bank-new-question`；顶栏「新建题目」改为与筛选类似的浮层（科目/题集/题号/题型、题组附加项、创建按钮），与「筛选条件」互斥展开；`pointerdown` 外部关闭与 Escape；创建成功后自动收起。

**验证命令**：`cd web; npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 题库 | 侧栏移除导出块与导出按钮文案

**改动摘要**：`BankWorkspace` 侧栏「题库管理」下删除导出按钮及说明段落；`exportBundle` 改为中文「导出题集」、英文「Export collection」；移除仅用于侧栏说明的 `exportHintNeedCollection`、`exportHintScope`。

**验证命令**：`cd web; npx tsc --noEmit`。

**结果要点**：TypeScript 通过。

## [2026-04-12] 题库 | 筛选条件改为顶栏下拉

**改动摘要**：`BankWorkspace` 将「筛选条件」下拉（科目/题集/题型/搜索 + `bankFilterSummary` + 点外部/Escape 关闭）置于顶栏 `ToolBar` 左侧首位；侧栏「题库管理」下不再放置筛选控件。曾删除未再使用的 `filterTapToCollapse` 文案键。

**验证命令**：`cd web; npx tsc --noEmit`。

**结果要点**：TypeScript 通过。