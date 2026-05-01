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

## [2026-04-12] 题库 | 题集改名/删除接口路径与错误码

**改动摘要**：`POST /api/bank/collections/rename|delete` 改为 `POST /api/bank/rename-collection`、`POST /api/bank/delete-collection`（与 `export-bundle` 同级，避免与 `GET …/collections` 组合时被误判）；题集目录不存在时由 **404 改为 400** 及明确 `detail`，与「路由未注册」区分。

**验证命令**：`pixi run pytest tests/test_bank_collection_rename_delete.py -q`；`cd web && npx tsc --noEmit`。

**结果要点**：4 passed；TypeScript 通过。

## [2026-04-12] 题库 | 题集改名/删除 API 与顶栏题集管理窗

**改动摘要**：`bank_service` 增加 `rename_question_collection`、`delete_question_collection`；`POST /api/bank/collections/rename|delete`；`BankWorkspace` 顶栏「题库管理」打开弹窗列表题集，支持改名与删除（排除 `main`）；重命名后同步筛选与已选题号。开发者文档 `http-api-overview.md` 补充路由。新增 `tests/test_bank_collection_rename_delete.py`。

**验证命令**：`pixi run pytest tests/test_bank_collection_rename_delete.py tests/test_bank_service_groups.py -q`；`cd web && npx tsc --noEmit`。

**结果要点**：8 passed；TypeScript 通过。

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

## [2026-04-12] 调试 | 题集改名 404 与 dev-desktop 后端拉起方式

**改动摘要**：`debug-4b9610.log` 仅有 H1（路由已注册 `POST /api/bank/rename-collection`），无 H5/H6，说明失败请求未进入当前仓库 Uvicorn 实例或改名请求未打到该进程。将 `scripts/dev-desktop.ps1` 中 `Start-Process python -m uvicorn ...` 改为 **`pixi run dev-backend`**（工作目录为仓库根），并在启动 Vite 前轮询 `/api/health`（`exam_workspace_layout=two_level`）最多约 45s。`wiki/modules/dev-environment.md` 补充说明。

**验证命令**：待用户 `pixi run dev` 复现后查看 `debug-4b9610.log` 是否出现 H6/H5 及改名是否仍 404。

**结果要点**：根因假说为 Tauri `beforeDevCommand` 子进程误用非 Pixi 的 `python`；修复对齐 `pixi.toml` 的 dev-backend 命令行与环境。

## [2026-04-12] 调试 | NDJSON 镜像与 H12 范围

**改动摘要**：用户反馈 `pixi run dev` 下改名后仓库根 `debug-4b9610.log` 仍无任何行（HF 依赖 7531 ingest 未启动时本就不会出现）。`_agent_debug` 改为同时追加 **`%TEMP%/solaire-debug-4b9610.log`**；H1 增加 `debug_log_repo` / `debug_log_mirror`；题库中间件改为注册在 CORS 之前，且 H12 覆盖「`POST`+`/api/bank` 前缀」或路径含 `rename-collection`/`delete-collection`（含 OPTIONS）。

**验证命令**：`pixi run dev` 后查看两处日志文件是否出现 H1/H12。

**结果要点**：区分「日志路径不可见」与「请求未进本进程」；HF 不作为唯一证据。

## [2026-04-12] 调试收尾 | 移除题集改名排查埋点

**改动摘要**：题集改名问题已确认修复；删除 `app.py` 中 `_agent_debug`、启动路由 dump、题库 HTTP 中间件、`bank_collection_rename` 入口日志及 `Request` 导入；删除 `BankWorkspace.tsx` 中发往 7531 ingest 的 fetch；`wiki/modules/dev-environment.md` 去掉临时 NDJSON 说明；删除仓库根 `debug-4b9610.log`。保留此前对 `scripts/dev-desktop.ps1`（`pixi run dev-backend` + health 等待）的修复。

**验证命令**：`cd web; npx tsc --noEmit`（可选）。

**结果要点**：代码恢复为无调试会话硬编码；运行时证据改由常规日志与健康检查承担。

## [2026-04-12] 助手模型配置 | 本机用户目录 + 项目覆盖

**改动摘要**：新增 `user_agent_paths`、`llm/user_llm_overrides`；`load_llm_settings` 合并环境 → 本机 `agent/llm_overrides.json` → 项目内覆盖；`load_safety_mode` / `PUT safety-mode` 与 `PUT llm-settings` 在未打开项目时写本机 `agent/safety_mode.json` 与 `llm_overrides.json`。`agent_api` 的 `llm-settings` / `safety-mode` GET 增加 `persist_scope`、`has_user_api_key_override`。前端欢迎页与设置页可未开项目即保存；文案与按钮区分本机/项目。新增 `tests/test_user_llm_overrides.py`、`wiki/modules/agent-user-settings.md`，更新 `docs/api/agent.md` 与 `wiki/index.md`。

**验证命令**：`pixi run pytest tests/test_user_llm_overrides.py -q`；`cd web && npx tsc --noEmit`。

**结果要点**：与产品「先全局、打开项目后项目优先」一致。

## [2026-04-13] Bug 修复 | 思维导图节点点击不打开编辑面板

**改动摘要**：`GraphWorkspace.tsx` 的 `handleNodeClick` 中，`setSelectedEdgeId(null)` 因 Zustand store 中 setter 的互清逻辑（`setSelectedEdgeId` 会同时置 `selectedNodeId: null`）导致刚设置的 `selectedNodeId` 被覆盖为 `null`。面板虽展开但 `selectedNode` 为空，仅显示占位文案。修复：移除 `handleNodeClick` 中冗余的 `setSelectedEdgeId(null)`（`setSelectedNodeId` 已自动清除 `selectedEdgeId`），同步简化 `handlePaneClick`。

**验证命令**：`cd web && npx tsc --noEmit`（类型检查无新增错误）；运行 `pixi run dev` 后在思维导图点击节点确认右侧编辑面板正常弹出。

**结果要点**：根因为 store setter 的隐式互斥副作用与 handler 中调用顺序冲突。

## [2026-04-13] UI | 图谱节点面板题目预览与题库一致

**改动摘要**：`GraphNodePanel.tsx` 已绑定题目列表与「从题库挑选」弹窗预览列改用 `KatexPlainPreview`，外层 `div.mt-0.5 block w-full min-w-0` 与 `className="line-clamp-3 text-xs leading-snug text-slate-600 [&_.katex]:text-[0.92em]"`，与 `BankWorkspace` 列表项一致。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：LaTeX 与题库侧摘要渲染路径统一。

## [2026-04-13] UI | 图谱节点面板隐藏内部标识

**改动摘要**：`GraphNodePanel.tsx` 编辑标签页移除「内部标识（只读）」标签与路径展示块，面向用户不再暴露节点路径式 id。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：`internalId` 文案键仍保留在 i18n，供其它提示复用。

## [2026-04-13] UI | 图谱节点面板隐藏学科字段

**改动摘要**：按科目分图后编辑侧栏不再展示学科下拉；`GraphNodePanel` 移除 `subjects` prop；保存仍通过 `draftSubject`（随节点数据同步）提交既有 `subject` 字段。`GraphWorkspace` 去掉对 `subjects` 的解构与传参。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：学科由当前图谱上下文隐含，避免重复编辑。

## [2026-04-13] UI | 图谱节点面板隐藏层级字段

**改动摘要**：学段/考纲层级改由图谱命名（如高中数学）表达；`GraphNodePanel` 移除层级下拉与 `levels` prop；保存时 `level` 沿用节点已有值（`selectedNode.level`），避免误清空。`GraphWorkspace` 不再解构或传入 `levels`；`loadGraphData` 仍 `setLevels` 以同步 taxonomy 供其它用途。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：侧栏不再编辑层级；新建子节点时 `GraphWorkspace` 继承父级 `level` 的逻辑未改。

## [2026-04-13] UI | 图谱节点面板名称与类型并排

**改动摘要**：`GraphNodePanel` 编辑页「标准名称」与「节点类型」置于 `grid grid-cols-2 gap-2` 同一行，列内 `min-w-0` 避免窄栏溢出。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：半宽并排，节省纵向空间。

## [2026-04-13] UI | 图谱视图切换移至顶栏 ToolBar

**改动摘要**：`GraphWorkspace` 使用 `useToolBar` 在 `ToolBar` 左侧注入「思维导图 / 知识图谱」分段按钮（样式与原先画布工具栏一致，外层增加 `bg-white` 以贴合顶栏）；`MindMapCanvas`、`GraphCanvas` 移除视图切换及相关 props。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：切换入口与 `BankWorkspace` 等页一致，离开图谱页 `clearToolBar` 回收。

## [2026-04-13] UI | 知识图谱节点 Handle 置于圆盘底层

**改动摘要**：`GraphCanvas.tsx` 的 `KnowledgeNode` 将 target/source 两个 `Handle` 提前并设 `z-0`，标签与标题包在 `absolute inset-0 z-[1]` 且与节点同色的圆角衬层内，视觉上盖住中心连线桩。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：连线逻辑不变，DOM 上 Handle 不再浮在文案之上。

## [2026-04-13] UI | 思维导图默认隐藏交叉关系线

**改动摘要**：`MindMapCanvas` 增加与画布类似的关系类型复选框（文案键 `relTypeMindmap`），默认四类全不勾选，不渲染非主树的交叉虚线与标签；勾选某类后仅显示该类的交叉连线。`zh`/`en` graph.json 新增翻译。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：主树实线始终显示；交叉关系按需显示。

## [2026-04-13] 功能 | 图谱节点笔记 Tab 与移除简述

**改动摘要**：后端 `GraphNodeNote` + `ConceptNode.notes`（[`service.py`](src/solaire/knowledge_forge/service.py)）；`GraphNodeCreateBody` 增加可选 `notes`（[`app.py`](src/solaire/web/app.py)）。前端 `GraphNodeRow.notes`、`PanelTab` 含 `notes`；[`GraphNodePanel.tsx`](web/src/graph/GraphNodePanel.tsx) 移除简述编辑；新增笔记 Tab（`LatexRichTextField` 编写、`ContentWithPrimeBrush` 预览、× 删除）；编辑保存与笔记保存均 PUT `notes`。`zh`/`en` graph.json 新增文案。

**验证命令**：`cd web; npx tsc --noEmit`；`pixi run pytest tests/test_graph_service.py tests/test_graph_api.py -q`（通过）。

**结果要点**：简述仍存于模型与旧数据，面板不再编辑；多条笔记独立增删。

## [2026-04-13] Bug 修复 | 仅保存笔记时 PUT 422

**改动摘要**：`GraphNodeCreateBody` 要求 `canonical_name`；`persistNotes` 原只传 `id`+`notes` 触发 422。`GraphNodePanel.persistNotes` 请求体增加 `canonical_name`（取自当前节点，兜底为 id）。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：笔记保存与编辑 Tab 保存均满足 FastAPI 请求体验证。

## [2026-04-13] Bug 修复 | GraphNodePanel 切换页面白屏（Hooks 顺序）

**改动摘要**：`persistNotes` 的 `useCallback` 曾写在 `if (!selectedNode) return …` 之后；`selectedNode` 变为 `null` 时提前返回导致少执行一个 hook，触发 `Rendered fewer hooks than expected`。已将 `persistNotes` 上移至该提前 return 之前，与其它 hooks 顺序一致。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：离开图谱或取消选中节点时不再因 hooks 数量不一致而崩溃。

## [2026-04-13] UI | 图谱节点笔记列表支持编辑

**改动摘要**：`GraphNodePanel` 笔记 Tab 每条笔记在「×」旁增加「编辑」；`noteEditingId` 区分新建与编辑；保存时对列表 `map` 更新对应 `body` 并 `persistNotes`；撰写区展示简短说明文案；`LatexRichTextField` 的 `syncTextAreaId` 含编辑 id 以便切换笔记时编辑器同步。`zh`/`en` graph.json 增加 `editNote`、`editNoteTitle`、`editNoteBanner`。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：可就地打开编辑器修改已有笔记并保存到节点。

## [2026-04-13] Bug 修复 | 助手侧栏「历史」下拉被裁剪不可见

**改动摘要**：`AgentChatPanel` 顶栏右侧将「历史」与含 `overflow-x-auto` 的按钮组拆成兄弟节点；`absolute` 会话列表不再处于横向滚动容器内，避免 `overflow-x` 非 `visible` 时纵向溢出被裁切。下拉 `z-index` 调至 `z-30`。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：overlay 模式下点击「历史」可正常看到会话列表。

## [2026-04-13] UI | 助手历史对话居中弹层与删除

**改动摘要**：`AgentChatPanel` 将「历史」由按钮下绝对定位改为在面板根节点 `relative` 内全屏半透明遮罩 + 居中卡片；标题栏含关闭；列表每行左侧打开会话、右侧「×」调用 `DELETE /api/agent/sessions/{id}`（新增 `apiAgentSessionDelete`）；删当前会话时走 `newChat`；打开历史时刷新列表；`Escape` 关闭。`zh`/`en` agent.json 增加 `historyDialogTitle`、`removeSessionTitle`、`confirmDeleteSession`、`sessionDeleteErr`。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：历史列表在智能助手区域内居中显示，不易被侧栏裁切；可删除单条对话。

## [2026-04-13] UI | 助手历史改为顶栏下锚定下拉

**改动摘要**：移除全屏居中遮罩与居中卡片；历史面板改为紧贴顶栏容器下缘（`absolute left-0 right-0 top-full`），与 Cursor 类「顶栏下展开」一致；`historyShellRef` + `document` `mousedown` 在区域外关闭；保留标题行、× 关闭、行内删除与 `Escape`。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：下拉从「智能助手 / 历史…」那一行正下方展开，宽度与侧栏内容区一致，仍叠在聊天区之上（`z-30`）。

## [2026-04-13] 行为 | 助手「新对话」不再预建 session

**改动摘要**：`AgentChatPanel` 的 `newChat` 仅中止流、清空 `sessionId` / 消息 / 任务步骤 / 快捷协助，不再调用 `apiAgentCreateSession`。服务端会话仍在用户首次 `send`（及需会话的 `confirm` / `planAction` 经 `ensureSession`）时创建。

**验证命令**：`cd web; npx tsc --noEmit`（通过）。

**结果要点**：反复点「新对话」不会在历史列表中增加空会话。

## [2026-04-13] CI | GitHub Actions 发布时自动构建 MSI

**改动摘要**：新增 `.github/workflows/release-msi.yml`；触发条件为 `release.published` 与手动 `workflow_dispatch`；在 `windows-latest` runner 上安装 Rust / Node 20 / Python 3.12 / maturin，执行前端构建、嵌入式 Python 运行时打包、WiX 预下载、`npm run tauri:build` 生成 MSI，并通过 `gh release upload` 附加到对应 Release。

**验证命令**：文件结构审查。

**结果要点**：发布 GitHub Release 后自动编译并上传 MSI 安装包。

## [2026-04-16] Bug 修复 | 桌面端「下载成绩表模板」改走原生另存为

**改动摘要**：桌面壳里 `<a download>.click()` 无法触发 webview 下载，导致 `AnalysisWorkspace.handleDownloadTemplate` 在 Tauri 下静默失效（web 端则悄悄落到浏览器下载目录）。新增 Rust 命令 `save_bytes_to_file(path, bytes)` 并注册进 `invoke_handler`；新增前端工具 `web/src/lib/saveBlobToDisk.ts`：Tauri 壳内使用 `@tauri-apps/plugin-dialog` 的 `save` 弹出系统另存为，再经上述命令写盘；浏览器模式保留原有 `<a download>` 行为。`handleDownloadTemplate` 改用该工具，并把失败信息写入已有的 `importError` 提示条，避免再次「静默无提示」。

**验证命令**：`cd web; npx tsc --noEmit`（待执行）；Rust 侧仅新增标准 `fs::write` 命令，依赖 `tauri-plugin-dialog` 已有权限 `dialog:default`。

**结果要点**：桌面端点击按钮会弹出系统「另存为」并把文件写到用户指定路径；取消对话框不报错；浏览器模式行为不变。

顺带覆盖同类问题：`AnalysisWorkspace` 的「下载元数据（analysis-metadata.json）」「下载图表（analysis-chart.svg）」，以及 `api/client.ts` 的题库导出 `downloadBankExportBundle`（`bank-export.bank.zip`）均改走 `saveBlobToDisk`。

## [2026-04-16] 扩展组件 | 手动路径传播到管线

**改动摘要**：在 `extension_registry` 新增 `resolve_exe(ext_id, exe_name)`：优先使用本页保存的可执行路径，否则回退 `PATH`。PDF 编译（`compile_tex.run_latexmk`）、Mermaid 渲染（`mermaid_expand.render_mermaid_to_svg_file`）、文档转换（`doc_tools.tool_doc_convert_to_markdown`）改为通过该函数解析，与设置页检测一致；`doc_tools` 中 Tesseract 亦统一经 `resolve_exe`。新增 `tests/test_extension_api.py` 中 `resolve_exe` 三类用例。

**验证命令**：`pixi run pytest tests/test_extension_api.py -q`（10 passed）。

**结果要点**：用户在「设置 → 扩展组件」指定的安装目录/程序文件会在实际导出与工具调用中生效，不再仅依赖系统 PATH。

## [2026-05-01] agent_layer | 计划审批、导出对齐、子任务隔离与记忆策略

**改动摘要**：`exam.export_paper` 对齐组卷页导出（备份/恢复、`mark_exported`、失败草稿、冲突目录需显式允许）；`agent.exit_plan_mode` 强制校验计划文件；`execution_plan_path` 须与会话内 `plan_ready` 待执行路径一致；子任务使用独立会话态并收窄工具集，Vivace 复核下沉至 `guardrails.vivace_fast_review`；`confirm_needed` 后补发 `done(awaiting_confirmation)`；主循环支持 `max_rounds` 与截断续写上限提示；系统提示拆稳定/动态层并推送 `context_metrics`；记忆自动写入加门槛、索引合并默认高阈值、`session_digest`/分析记录超长裁剪；补充 API 文档与 `wiki/modules/agent-layer.md`。

**验证命令**：`pixi run pytest tests/test_agent_layer.py tests/test_agent_plan_and_subagent.py tests/test_agent_exam_export.py tests/test_user_llm_overrides.py -v`

**结果要点**：31+5 项相关 pytest 通过；前端计划「取消」携带 `clear_pending_plan_path`。

## [2026-04-16] 开发环境 | 恢复 dev-backend 的 `--reload-dir src`

**改动摘要**：当前 `pixi.toml` 中 `dev-backend` 曾回退为仅 `--reload`（监视整个仓库根目录），`tauri dev` 时 `src-tauri/target/.../site-packages` 会再次触发 WatchFiles 误重载；已重新加上 `--reload-dir src`。

**验证**：检视 `pixi.toml` 的 `dev-backend` 行。

**结果要点**：热重载仅盯 `src/`，与 `start-web.ps1` / `start-web.sh` 一致；合并分支时注意勿覆盖此行。

## [2026-05-01] agent_layer | 缺口补全（测试、记忆开关、上下文哈希）

**改动摘要**：补充回归测试覆盖 `max_rounds` 耗尽、取消路径、`context_metrics` 工具哈希输出与记忆禁写；`/api/agent/chat` 新增 `skip_memory_write`（本轮不自动写记忆）；`orchestrator` 的 `context_metrics` 增加 `tool_schema_sha12` 与 `tool_count`；`prompt_cache.py` 增加可复用哈希函数（文本与工具 payload）；同步 `docs/api/agent.md` 与 `wiki/modules/agent-layer.md`。

**验证命令**：`pixi run pytest tests/test_agent_layer.py tests/test_agent_plan_and_subagent.py tests/test_agent_exam_export.py tests/test_user_llm_overrides.py -q`

**结果要点**：41 项相关测试通过；SSE 可观测指标可区分稳定前缀变化与工具集变化；可按请求关闭单轮自动记忆写入。

## [2026-05-01] 模型服务切换 | provider、Responses/Messages 适配与欢迎页/设置表单

**改动摘要**：`LLMSettings` 增加 `provider`（`openai` / `anthropic` / `openai_compat` / `deepseek`），合并进本机与项目 `llm_overrides`；`openai` 走 OpenAI Responses API（`openai_responses.py`），`anthropic` 走 Messages API（`anthropic_messages.py`），兼容与 DeepSeek 仍用 Chat Completions；`GET/PUT /api/agent/llm-settings` 增加 `provider` 与 `provider_options`；前端 `AgentModelSettingsForm` 与欢迎页/设置页模型区；`pixi.toml` 增加 `anyio`、`anthropic` pypi 依赖。

**验证命令**：`pixi run pytest tests/test_user_llm_overrides.py tests/test_llm_router.py tests/test_agent_layer.py tests/test_agent_plan_and_subagent.py -v`；`cd web && npm test -- AgentModelSettingsForm --run`

**结果要点**：上述 pytest 与 Vitest 通过；文档已更新 `docs/api/agent.md`、`wiki/modules/agent-user-settings.md`、`wiki/modules/agent-layer.md`。

## [2026-05-01] agent API | /api/agent/llm-settings 契约测试

**改动摘要**：新增 `tests/test_agent_llm_settings_api.py`，覆盖 `provider`/`provider_options` 返回、项目内持久化、访问凭据脱敏、非法服务类型 400、`/api/agent/config` 的 `provider` 字段。

**验证命令**：`pixi run pytest tests/test_agent_llm_settings_api.py -q`

**结果要点**：5 项 pytest 通过。

## [2026-05-01] DeepSeek 兼容 | OpenAI 思考模式请求形状

**改动摘要**：`OpenAICompatAdapter` 在 `provider=deepseek` 或服务地址含 `deepseek.com` 时启用 `deepseek_compat`：请求增加 `extra_body["thinking"]` 与 `reasoning_effort`（与官方 OpenAI 兼容示例一致），有工具时不发 `parallel_tool_calls`，流式不启用 `stream_options`；`TypeError` 时回退去掉 `reasoning_effort`。补充单测与 `ModelRouter` 用例。

**验证命令**：`pixi run pytest tests/test_agent_layer.py::test_openai_compat_deepseek_adds_thinking_extra_body tests/test_agent_layer.py::test_openai_compat_generic_parallel_tool_calls_with_tools tests/test_llm_router.py::test_model_router_adapter_by_provider -q`

**结果要点**：上述用例通过；说明见 [DeepSeek 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)。

## [2026-05-01] DeepSeek | 工具 function.name 含点号被拒（400）

**改动摘要**：DeepSeek 要求 `tools[].function.name` 符合 `^[a-zA-Z0-9_-]+$`。`OpenAICompatAdapter` 在 `deepseek_compat` 下对请求中的工具定义与历史 `assistant.tool_calls` 将 `analysis.foo` 转为 `analysis_foo`，响应再映射回注册表中的 canonical 名以便 `invoke_registered_tool`；已补充单测。

**验证命令**：`pixi run pytest tests/test_agent_layer.py::test_openai_compat_deepseek_rewrites_dotted_tool_names -q`

**结果要点**：1 passed。

## [2026-05-01] DeepSeek | 后续工具轮：tool.name 字符集与空 reasoning

**改动摘要**：出站历史中的 `role=tool` 的 `name` 与 assistant 的 `function.name` 一致改为下划线形式，避免网关对与 `tools[].function.name` 相同的模式校验；流式工具轮若未收到 `delta.reasoning_content`，用已组装的正文 `content` 作为 `accumulated_reasoning` 回退，再否则用 `"."`，避免落库空串导致下一轮思考模式 400；非流式 `chat()` 在带工具且 reasoning 空时同样用 `content` 兜底。补充 `test_prepare_deepseek_wires_tool_message_name`。

**验证命令**：`pixi run pytest tests/test_agent_layer.py::test_prepare_deepseek_wires_tool_message_name tests/test_agent_layer.py::test_openai_compat_deepseek_extra_body_preserves_reasoning_in_messages -q`

**结果要点**：2 passed。

## [2026-05-01] 上下文压缩 | 避免拆散 assistant 与 tool 触发 400

**改动摘要**：`ContextManager._maybe_compact` 原先用 `messages.pop(2)` 单条删除，可能删掉带 `tool_calls` 的 `assistant` 而留下后续 `tool`，严格网关（DeepSeek）报错「tool 必须紧接在带 tool_calls 的 assistant 之后」。改为按段删除：含工具的 `assistant` 与其后连续 `tool` 同删；`user` 则删至下一 `user` 之前的整块；若以孤儿 `tool` 开头则先删连续 `tool`。`build_messages` 在压缩前对前缀后历史做链式校验并去掉孤儿 `tool`。stub 起始下标按 1～2 条 system 前缀自适应。补充 `test_drop_oldest_history_*`、`test_sanitize_tool_chains_*`。

**验证命令**：`pixi run pytest tests/test_agent_layer.py::test_drop_oldest_history_removes_assistant_and_tools_together tests/test_agent_layer.py::test_sanitize_tool_chains_drops_orphan_tool_after_system -q`

**结果要点**：2 passed。

## [2026-05-01] DeepSeek | reasoning_content 被 OpenAI SDK 裁掉致 400

**改动摘要**：官方 `openai` 库在发起 Chat Completions 时按 TypedDict 裁剪 `messages`，导致已持久化的 `reasoning_content` 无法到达 DeepSeek 网关，思考模式 + 工具轮次触发「须回传 reasoning_content」。`deepseek_compat` 下在 `extra_body` 中合并完整 `messages` 深拷贝（SDK 合并 JSON 时 `extra_json` 覆盖同名键），流式与非流式共用；补充单测。

**验证命令**：`pixi run pytest tests/test_agent_layer.py::test_openai_compat_deepseek_extra_body_preserves_reasoning_in_messages -q`

**结果要点**：1 passed。

## [2026-05-02] DeepSeek 兼容 + 缓存 | 多 tool_call 消息链断裂、工具名格式、memory 停用、提示拆层

**改动摘要**：

1. **`_sanitize_tool_chains` 修复**（致命 bug）：旧逻辑仅认前一条 `assistant` 为合法前驱，导致多 tool_call 场景下第 2+ 条 tool 响应被误删→严格网关 400。改为向前回溯到非 tool 锚点判断；新增 Pass 2 补全缺失 tool_call_id 的占位消息。
2. **工具名 wire 转换扩展至所有 `openai_compat`**：不再限 `deepseek_compat=True`；废弃 `@lru_cache`，反向映射从 `_TOOL_BY_NAME` 实时构建，焦点切换后不会失效。`_prepare_deepseek_request_payload` → `_prepare_compat_request_payload`。
3. **自动记忆写入禁用**：`emit_memory_after_assistant_turn` 改为空操作；系统提示移除记忆索引注入（`_layer_memory` / `memory_index_excerpt` 参数删除）；orchestrator 循环内不再调用 `read_index`。`memory.*` 只读工具保留。
4. **系统提示拆三层**：`build_stable_system_prompt()` 不再接受 `tool_descriptions` 参数（纯角色/约束/规范），新增 `build_tools_system_block`；`context_metrics` 增加 `tools_block_sha12`。
5. **orchestrator 循环缓存**：`stable_txt` 在循环外预构建；`tools_block_txt` 仅焦点切换后重建。
6. **reasoning_content 兜底清理**：不再用 content 或 `"."` 填充 reasoning；tool_calls 无 reasoning 时设空串。
7. **死代码清理**：删除 `session_to_api_messages`、`_layer_memory`；`_ensure_assistant_tool_calls_have_reasoning` 提取到 `llm/message_utils.py`；`subagent.py` docstring 补丁残留修复。

**验证命令**：`pixi run pytest tests/test_agent_layer.py tests/test_llm_router.py -v`

**结果要点**：40 passed（新增 7 测试全通过），1 pre-existing failure（`test_guardrail_read_vs_export`，与本次改动无关），llm_router 3 passed。

## [2026-05-02] 编排层 | 重复工具批次熔断、上下文 200k、去除自动续写、侧栏上下文估算

**改动摘要**：主循环改为按「连续完全相同的 tool_calls 批次」计数触发 `repeat_loop`（`max_llm_rounds` 现为该阈值）；移除 length 自动续写与用户「请继续」注入；`ContextManager.TOKEN_BUDGET_TOTAL` 调至 200000；`done` 事件增加 `context_tokens_est`（发往模型的消息估算峰值）；`utils.tool_calls_signature` 统一规范化指纹；子任务循环对齐重复熔断逻辑；侧栏标题展示上下文估算文案；更新 `docs/api/agent.md`、`wiki/modules/agent-layer.md`；测试 `test_run_agent_turn_emits_repeat_loop_when_identical_tool_calls_repeat` 替换原 max_rounds 用例。

**验证命令**：`pixi run pytest tests/test_agent_plan_and_subagent.py tests/test_agent_layer.py -v --tb=short`

**结果要点**：`test_agent_plan_and_subagent` 7 passed；`test_agent_layer` 中 40 passed，1 failed（`test_guardrail_read_vs_export`，与本次改动无关，与 log 既有记录一致）。

## [2026-05-02] 编排层 | 修复无工具调用时丢失 reasoning_content 的问题

**改动摘要**：`orchestrator.py` 在 `run_agent_turn` 中，如果助手回复无工具调用（常见于结束任务或退出 `plan_mode` 时纯文本响应），创建 `ChatMessage` 时漏传了 `reasoning_content`。这导致 `Pydantic` 默认将其置为 `None`，进而序列化为 `null` 并在持久化层和前端交互中丢失了思考过程。本次修复在追加消息时显示传入 `reasoning_content=round_reasoning or ""`，包含自动因为长度或结束而返回的文本节点，以及因为死循环产生的报错节点。

**验证命令**：手动代码走查与确认。

**结果要点**：修复逻辑已在本地写入。