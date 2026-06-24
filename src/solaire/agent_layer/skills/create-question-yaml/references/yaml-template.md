# 题目模板参考

## metadata 默认字段

新建或导入题目时，默认写入以下键值字段，便于题库页和组卷页按标签筛选。知识点归属不要写进 metadata；请通过知识图谱绑定表达。

```yaml
metadata:
  难度: 中
  来源: 原创
  年份: 2026
  题目用途: 测评
  难度评分: 0.5
  创新性: 0.3
```

- `难度` 建议值：`低` / `中` / `高`。
- `题目用途` 建议值：`新授` / `巩固` / `复习` / `测评` / `补弱` / `压轴`。
- `难度评分`、`创新性` 必须是 0 到 1 的数字，数值越高表示越难/越创新。
- `来源`、`年份` 按题目材料如实填写；无法确定时使用 `未注明` 或当前年份。

## 基础模板（单题）

```yaml
id: your_question_id
type: short_answer
content: |-
  在此填写题干。
answer: |-
  在此填写答案。
analysis: |-
  在此填写解析（可留空）。
metadata:
  难度: 中
  来源: 原创
  年份: 2026
  题目用途: 测评
  难度评分: 0.5
  创新性: 0.3
```

## 选择题模板

```yaml
id: your_choice_question_id
type: single_choice
content: |-
  在此填写题干。
options:
  A: 选项A
  B: 选项B
  C: 选项C
  D: 选项D
answer: A
analysis: |-
  在此填写解析（可留空）。
metadata:
  难度: 中
  来源: 原创
  年份: 2026
  题目用途: 测评
  难度评分: 0.5
  创新性: 0.3
```

## 判断题模板

```yaml
id: your_judge_question_id
type: judge
content: |-
  在此填写题干。
answer: T
analysis: |-
  在此填写解析（可留空）。
metadata:
  难度: 低
  来源: 原创
  年份: 2026
  题目用途: 巩固
  难度评分: 0.2
  创新性: 0.1
```

## 注意

- `type` 仅可为：`single_choice` / `multiple_choice` / `fill` / `judge` / `short_answer` / `reasoning` / `essay`（旧 `choice` 可读取兼容）。
- 仅 `single_choice` / `multiple_choice` 题允许 `options`。
- `judge` 题 `answer` 仅可为 `T` 或 `F`。
- 其余题型不要写 `options`。
