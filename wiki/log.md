# Wiki 变更日志（仅追加）

每条建议格式：`## [YYYY-MM-DD] 类型 | 简述`，类型可为：任务、ingest、lint、初始化 等。

---

## [2026-04-09] 初始化 | 建立 wiki 目录、索引、首轮模块页与 Cursor 规则

- 新增 `wiki/` 知识库与 `.cursor/rules` 工作流；内容依据 `README.md` 与 `src/solaire_doc/developer/dev-workspace.md` /bootstrap。

## [2026-04-09] 任务 | 高考九科 Gaokao*.tex.j2 与 gaokao2024_*.yaml

- 在 `src/solaire/exam_compiler/templates/latex/` 新增九份完整 `Gaokao*.tex.j2`；在 `examples/web_sample_project/templates/` 新增 `gaokao2024_{math,chinese,english,physics,chemistry,biology,politics,history,geography}.yaml`，并将 `gaokao2024.yaml` 的 `latex_base` 改为 `GaokaoMath.tex.j2`、解答题均分改为 15.4 以凑满 77 分。
- 验证：`pixi run python` + `load_template` 核对各科 YAML 分值合计（150 或 100）；`render_tex` 最小题干 + `xelatex` 编译 `GaokaoMath` 烟测 PDF 通过。
