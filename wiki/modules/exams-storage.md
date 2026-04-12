# 考试目录与接口（exams）

## 目录模型

- 唯一业务根目录：**`exams/`**。
- 路径：**`exams/<标签段>/<学科段>/`**（由「试卷说明」「学科」规范化并做目录名安全处理得到）。
- 同目录包含：`exam.yaml`、`config.json`、导出 PDF、`scores/<batch_id>/`。
- **草稿**与**已导出**仅靠 **`config.json` 的 `status`**（`draft` / `exported`）区分。
- **`GET /api/exams/{exam_path}` 返回的 `exam_id`**：以 URL 所解析的 **`exams/<标签段>/<学科段>/` 目录为准**，会覆盖 `exam.yaml` 内可能残留的历史单段 id，避免组卷前端仍持有旧标识。
- **`exam.yaml` 的 `template_path`**：历史上可能写成相对考试目录的 `../templates/xxx.yaml`；加载与保存时会规范为相对项目根的 `templates/xxx.yaml`，以便与 **`GET /api/templates`** 列表一致，避免组卷页无法匹配模板、小节空白。
- **`export_label` / `subject` 为空**：若 YAML 中未写或导出后未回填，**`GET /api/exams/{id}`** 会用目录 **`exams/<标签段>/<学科段>/`** 补全试卷说明与学科（与组卷中间栏「考试标签」「学科」一致）。

### 常见误解

- **成绩导入批次目录**：`scores/` 下每个子目录名为导入批次标识（实现上为十六进制串），**不是**考试目录名。考试目录始终是上面两级的 **`exams/<标签段>/<学科段>/`**。
- **预览 PDF**：临时预览在 **`.solaire/previews/<id>/`**，与 `exams/` 无关。

## HTTP（摘要）

- 列表与组卷：`GET/POST/PUT/DELETE /api/exams/...`（路径中含 `/` 时使用 `{exam_path:path}`）。
- 成绩分析列表：`GET /api/exams/analysis-list`。
- 从历史复制草稿：`POST /api/exams/from-exam/{exam_path}`，请求体含新「试卷说明」。
- PDF：`GET/POST /api/exams/{exam_path}/pdf-file`、`open-pdf`。
- 导出：`POST /api/exam/export`，成功响应字段 **`exam_dir`**（相对项目根）。

更全路由见内嵌帮助 `http-api-overview.md` 与 `src/solaire/web/app.py`。

## 组卷界面（ComposeWorkspace）

- **学科筛选下拉**：选项为「题库目录学科 ∪ 当前试卷学科」；若仅依赖 `/api/bank/subjects`，当某套试卷的学科在题库尚无目录时，`select` 无对应 `option`，浏览器无法显示当前学科（表现为未自动筛到该科）。
- **左侧题库**：Ctrl/⌘ 多选、Shift 区间选，再点箭头加入**当前小节**；混题型时跳过并提示。
- **右侧试卷**：在同一 **`section_id`（题型小节）** 内 Ctrl/⌘ 多选、Shift 区间选，再点箭头批量移出；**不可跨小节多选**。题组槽位作为一整条参与多选/区间。

## 验证

- 前端：`cd web && npm run build`
- 后端语法：`python -m compileall src/solaire/web/app.py src/solaire/web/exam_service.py src/solaire/web/result_service.py src/solaire/web/exam_workspace_service.py`
- 相关测试：`pixi run pytest tests/test_result_service.py tests/integration/test_results_analysis_baseline.py -q`
