# SolEdu 开发者 Wiki（Schema）

本目录是面向 **自动化代理（Agent）与代码维护者** 的持久化知识库，与 [llm_wiki.md](llm_wiki.md) 中描述的「模式」一致：**先读索引、再钻专题、有结论后回写**，使知识随迭代累积而非每次从零检索。

## 与 `llm_wiki.md` 的关系

- [llm_wiki.md](llm_wiki.md) 说明通用理念（原始资料层、wiki 层、模式文档、索引与日志等）。
- **本项目落地约定以本文件为准**：目录角色、维护流程、与仓库根 [README.md](../README.md) / [docs/](../docs/) 的分工。

## 目录结构

| 路径 | 作用 |
|------|------|
| [index.md](index.md) | **检索入口**：按分类列出各页链接与一句话摘要；新增或重命名 wiki 页时须同步更新。 |
| [log.md](log.md) | **时间线**：按日期追加任务、改动摘要、验证命令与结果要点。 |
| [architecture/](architecture/) | 跨模块心智模型：总览、路径速查（file-map）等。 |
| [modules/](modules/) | 可独立演进的专题（桌面启动、开发环境等）。 |
| [llm_wiki.md](llm_wiki.md) | 模式理念说明（可随上游思路更新，非强制与本仓库一一对应）。 |

## 任务前 / 任务后（与 Cursor 规则一致）

1. **任务开始前**：阅读 [index.md](index.md)，定位与当前任务相关的 1～3 个页面；优先按 wiki 行动，仅在未覆盖或需核对细节时再搜索代码。
2. **任务结束后**（有结论或可复用知识时）：更新对应 `architecture/` 或 `modules/` 页面；在 [log.md](log.md) **末尾追加**一条（建议标题：`## [YYYY-MM-DD] 任务 | 简述`）；若新增或重命名页面，更新 [index.md](index.md)。

**何时必须回写 wiki**（摘要，细则见 `.cursor/rules/llm-wiki-scope.mdc`）：公共 HTTP 契约变更、跨模块目录/环境变量/启动方式变更、可复现验证命令或任务名变更、桌面嵌入与端口等行为与文档不一致时。纯内部重构且对外行为不变时可不改 wiki。

## `file-map` 的维护边界

[architecture/file-map.md](architecture/file-map.md) 采用 **目录 + 锚点文件** 两层，不追求全库逐文件登记。若发生 **顶层目录调整、入口文件重命名或迁移、公共契约路径变更**，应在同一变更中更新 `file-map.md` 与 [index.md](index.md)（如适用），并在 [log.md](log.md) 记一笔。

## 语言与产品边界

- Wiki 正文使用 **简体中文**。
- 面向最终用户的界面文案不得泄露实现细节；技术说明写在 wiki、[docs/](../docs/) 或包内开发者文档中。

## 延伸阅读

- 安装与功能概览：仓库根 [README.md](../README.md)
- HTTP API、桌面构建等：[docs/](../docs/)
- 应用内用户手册（包内）：`src/solaire/web/assets/help_docs/`

## 原始资料层（可选）

若将来需要在本仓库内固定存放「待消化」的外部长文或剪报，可再增设例如 `wiki/raw/` 或独立目录，并在本文件补充约定；当前不强制创建空目录。
