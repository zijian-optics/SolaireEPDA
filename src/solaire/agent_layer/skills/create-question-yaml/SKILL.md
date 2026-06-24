---
name: create_question_yaml
description: >
  按题库单题规范起草并写入题目（新建或更新），依赖服务端校验。当教师提到新建题目、
  录入题目、按规范出题、改题干选项等关键词时激活此技能。
metadata:
  author: solaire-builtin
  version: "1.1"
  label: 按规范创建题目
  tool_patterns: "bank.create_item bank.update_item bank.get_item bank.search_items graph.search_nodes graph.bind_question graph.batch_bind_questions file.read file.list file.search agent.read_skill_reference agent.switch_focus agent.activate_skill agent.enter_plan_mode agent.exit_plan_mode agent.set_task_plan agent.update_task_step agent.run_subtask agent.run_tool_pipeline memory.read_index memory.read_topic memory.search"
  suggested_user_input: 请帮我按题库规范创建一道新题，并确保格式校验通过。
---

## 工作流程

1. 按字段组织单题正文（字段清单与样例见 `agent.read_skill_reference`，`name`=`create_question_yaml`，`path`=`references/yaml-template.md`）
2. 需要参照现有题时可用 `bank.get_item` 或 `file.read` 读取项目内 YAML
3. 新建调用 `bank.create_item`；改题调用 `bank.update_item`
4. 校验失败时根据返回信息逐项修正，避免猜测合法取值

## 默认 metadata 与图谱挂载

- 新建或导入题目时，默认写入操作筛选型 metadata：`难度`、`来源`、`年份`、`题目用途`、`难度评分`、`创新性`。
- `难度` 建议值：`低` / `中` / `高`；`题目用途` 建议值：`新授` / `巩固` / `复习` / `测评` / `补弱` / `压轴`。
- `难度评分`、`创新性` 写为 0 到 1 的数字；数值越高表示越难/越创新。
- 不要把知识点/核心考点重复写进 metadata；知识归属由知识图谱绑定表达。
- 保存题目后，根据题干与解析中的明确知识点调用 `graph.search_nodes` 搜索已有图谱节点；只有候选唯一且名称/别名精确匹配时，才调用 `graph.bind_question` 或 `graph.batch_bind_questions` 自动挂载。无候选或多个候选时，仅报告未自动挂载原因，不新建图谱节点。

## 题型与规则（摘要）

- `type`：`single_choice` / `multiple_choice` / `fill` / `judge` / `short_answer` / `reasoning` / `essay`（旧 `choice` 可读取兼容）
- 仅 `single_choice` / `multiple_choice` 可有 `options`；`judge` 的 `answer` 仅为 `T` 或 `F`

## 参考文件

- `references/yaml-template.md`：可复制粘贴的 YAML 骨架（用 `agent.read_skill_reference` 读取，勿用 `file.read` 访问技能包路径）

## 注意事项

- 题干中若含教育绘图围栏（PrimeBrush），勿手写非法 `op`；复杂图稿可切换 `primebrush_diagrams` 技能并对照其 `references/`

