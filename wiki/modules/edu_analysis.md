# 模块：学情分析（EduAnalysis / SkillAnalyzer）

## 主目录

- `src/solaire/edu_analysis/`（代码目录名仍为 `edu_analysis`）

## 职责

考试结果多维诊断（班级/学生/知识点）；支持用户自定义脚本扩展。

## 图形扩展规范（摘要）

- 用户脚本运行时提供 `get_rawdata()`、`get_graph()`。
- 推荐返回图形对象实例（如直方图、扇形图），而非手写复杂结构。
- 图形对象建议实现：`to_payload()`、`get_picture(...)`（如 SVG）。
- 保持旧版 `RESULT` 字典兼容，避免历史脚本失效。

## 验证

- 基线回归：`scripts/check_edu_analysis_baseline.ps1`（Windows）
- 详见 [runbooks/build-test.md](../runbooks/build-test.md)
