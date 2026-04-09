# 模块：试卷编译（ExamCompiler）

## 主目录

- `src/solaire/exam_compiler/`

## 职责（产品侧）

从题库选题、模板组卷，导出学生版/教师版 PDF 等；业务规则以本包为准，Web 仅编排。

## 高考九科 LaTeX 模板（内置）

- **位置**：`src/solaire/exam_compiler/templates/latex/`，主模板为九份独立 `Gaokao*.tex.j2`（`GaokaoMath`、`GaokaoChinese`、`GaokaoEnglish`、`GaokaoPolitics`、`GaokaoHistory`、`GaokaoGeography`、`GaokaoPhysics`、`GaokaoChemistry`、`GaokaoBiology`）。
- **依赖**：`ctexart` 与常见宏包（`amsmath`/`geometry`/`enumitem` 等），**不**依赖外部 `exam-zh` 文档类；理科模板通过 `metadata_defaults.include_common_math_macros` 控制常用数学宏。
- **卷面结构示例**：`examples/web_sample_project/templates/gaokao2024_*.yaml`（语数英 150 分对齐新课标全国卷常见题型与总分；选考六科各 100 分，采用多省公开文件中较常见的题量/分值组合，**各省自主命题可能不同**，可按本省调整 `sections`）。
- **既有示例**：同目录下 `gaokao2024.yaml` 已改为使用内置 `GaokaoMath.tex.j2`（与 `gaokao2024_math.yaml` 一致）。

## 相关

- [primebrush.md](primebrush.md)（插图与声明式图形）
- [architecture/overview.md](../architecture/overview.md)
