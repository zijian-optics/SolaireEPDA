---
name: outline_graph_import
description: >
  将大纲、课标或复习材料中的要点层级整理为图谱节点与关系，并批量写入当前项目。
  当教师提到导入大纲、课标整理、知识点结构化、批量建要点等关键词时激活此技能。
metadata:
  author: solaire-builtin
  version: "2.1"
  label: 课标大纲导入图谱
  tool_patterns: "graph.list_graphs graph.create_graph graph.delete_graph graph.list_nodes graph.search_nodes graph.create_node graph.batch_create_nodes graph.update_node graph.delete_node graph.list_relations graph.create_relation graph.update_relation graph.batch_create_relations graph.delete_relation graph.bind_question graph.batch_bind_questions graph.attach_resource file.write file.list file.read file.search web.search agent.switch_focus agent.activate_skill agent.read_skill_reference agent.enter_plan_mode agent.exit_plan_mode agent.set_task_plan agent.update_task_step agent.run_subtask agent.run_tool_pipeline memory.read_index memory.read_topic memory.search"
  suggested_user_input: 请根据我提供的高考大纲内容，整理成知识要点并批量写入当前项目的知识图谱。
---

## 节点类型与连接规则

图谱包含三种节点（`node_kind`）和四种关系（`relation_type`）。
**不同学科对节点之间的连接有严格约束。**

### 节点类型

| node_kind  | 含义 | 说明 |
|------------|------|------|
| `concept`  | 知识点 | 核心实体，文理通用 |
| `skill`    | 能力/技能 | 理科专用桥接节点（如「求导」「配平」） |
| `causal`   | 因果 | 文科专用桥接节点（如「导致通货膨胀」「引发革命」） |

### 关系类型

| relation_type   | 含义 | 典型用途 |
|-----------------|------|---------|
| `part_of`       | 组成 | 子要点 → 父要点（创建子节点时自动生成） |
| `prerequisite`  | 先修 | 表达学习顺序依赖 |
| `related`       | 弱关联 | 概念 ↔ 能力/因果的桥接边 |
| `causal`        | 因果 | 因果推理链 |

### 连接约束（关键）

**理科（数学、物理、化学、生物等）：**

- ✅ `concept ↔ concept`（prerequisite / related / part_of）
- ✅ `concept ↔ skill`（related）— 能力节点桥接两个知识点
- ❌ `skill ↔ skill` — 禁止能力节点之间直连

> 示例：「函数」(concept) —related→ 「求导」(skill) —related→ 「导数」(concept)

**文科（历史、政治、地理等）：**

- ✅ `concept ↔ concept`（prerequisite / related / part_of）
- ✅ `concept ↔ causal`（related / causal）— 因果节点桥接两个知识点
- ❌ `causal ↔ causal` — 禁止因果节点之间直连

> 示例：「工业革命」(concept) —related→ 「推动城市化」(causal) —related→ 「城市化进程」(concept)

**通用约束：**

- `skill` 和 `causal` 节点不混用于同一学科
- 桥接节点（skill / causal）的两端必须各连接至少一个 `concept` 节点

## 工作流程

1. **识别学科** — 从材料判断理科 / 文科，决定桥接节点类型（`skill` 或 `causal`）
2. **抽取层级清单** — 父要点 → 子要点，标注每个要点的 `node_kind`
3. **提取补充资料** — 从材料中识别与各要点关联的描述、定义、事件说明等内容片段
4. **自检连接合法性** — 建关系前逐条核对上述约束表，违规则修正
5. **向教师确认执行计划** — 摘要呈现：
   - 将新增 N 个节点 / M 条关系
   - 将为 K 个要点挂载补充资料（列出要点名称与资料摘要）
   - **教师确认后方可执行后续步骤**
6. **批量创建节点** — `graph.batch_create_nodes`，先父后子
7. **批量创建关系** — `graph.batch_create_relations`，仅建立合法边
8. **写入并挂载补充资料**（需教师在步骤 5 中已同意）：
   - 用 `file.write` 将资料写入 `resource/graph/notes/` 目录，文件名建议 `{node_id}.md`
   - 逐条调用 `graph.attach_resource` 挂载到对应节点（无批量接口，需逐个调用）
9. **需核对公开表述时** — `web.search` 查证，摘录注明来源与日期

## 注意事项

- 不扩充材料中未出现的知识点；不确定处向教师确认
- 对桥接节点务必标注 `description` 说明其连接的两个概念
- 资料挂载的内容应忠于原文，仅做必要的格式化整理，不添加未出现的内容
