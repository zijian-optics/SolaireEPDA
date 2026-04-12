# 考试目录与接口（exams）

## 目录模型

- 唯一业务根目录：**`exams/`**。
- 路径：**`exams/<标签段>/<学科段>/`**（由「试卷说明」「学科」规范化并做目录名安全处理得到）。
- 同目录包含：`exam.yaml`、`config.json`、导出 PDF、`scores/<batch_id>/`。
- **草稿**与**已导出**仅靠 **`config.json` 的 `status`**（`draft` / `exported`）区分。

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

## 验证

- 前端：`cd web && npm run build`
- 后端语法：`python -m compileall src/solaire/web/app.py src/solaire/web/exam_service.py src/solaire/web/result_service.py src/solaire/web/exam_workspace_service.py`
- 相关测试：`pixi run pytest tests/test_result_service.py tests/integration/test_results_analysis_baseline.py -q`
