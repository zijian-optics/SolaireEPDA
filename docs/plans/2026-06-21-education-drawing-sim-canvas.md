# 教育绘图与仿真画布路线

## 目标

把 SolEdu 的“教育绘图”从题目中的代码围栏能力，推进为软件内可直接操作的绘图与仿真工作区。教师应能在题库、组卷、知识图谱笔记和助手会话中快速生成可复用插图，并保留可编辑的声明式源数据。

首要入口是题库编辑器里的教育绘图面板；长期形态是一个可停靠的教育绘图边栏和独立仿真画布。

## 现有底座

- `src/solaire/primebrush/` 已有声明式 YAML 到 SVG 的渲染框架，并支持 `geometry_2d`、`plot_2D`、`chart`、`chemistry_molecule`。
- `src/solaire/exam_compiler/pipeline/diagram_expand.py` 已经把 `primebrush` 围栏展开为 Web/PDF 可用图片。
- `web/src/components/LatexRichTextField.tsx`、`BankQuestionEditorPanel.tsx` 已有公式、Mermaid、图片插入链路，可以复用为教育绘图插入链路。
- `src/solaire/sim_canvas/__init__.py` 已预留 SimCanvas 的定位：偏教学示意，优先定性正确和视觉清晰，不追求工程级数值仿真。
- `primebrush-rs/` 已存在 Rust/WASM 迁移方向，可承接后续高频渲染和局部仿真计算。

## 产品原则

1. 图不是一次性图片，必须保留可编辑源数据。
2. 首版优先“可用模板 + 实时预览 + 插入题目”，之后再做拖拽式所见即所得。
3. 同一套 PrimeBrush/SimCanvas 源协议要服务 Web 预览、PDF 导出、助手生成和未来素材库。
4. 仿真画布先做课堂示意，默认定性正确；需要精确数值时再明确标注能力边界。
5. 学科插件以教学高频场景为单位推进，而不是按底层图元堆功能。

## 分层设计

### 前端

- `PrimeBrushEditorModal`：题库编辑器中的首版教育绘图面板。
- 未来 `EducationalDrawingSidebar`：可停靠边栏，服务题库、组卷、知识图谱笔记等页面。
- 未来 `DrawingPreviewCanvas`：统一承载 SVG 预览、可选图层、标注、导出和插入。
- 未来 `SimCanvasWorkspace`：承载时间步进、参数滑块、场线密度、动画暂停/截图等仿真控件。

### 后端

- `/api/primebrush/render`：无项目依赖的即时预览接口，输入 PrimeBrush YAML，输出 SVG。
- `solaire.primebrush.plugins.*`：静态教学图插件，继续用 `type` 分发。
- `solaire.sim_canvas`：动态或半动态教学仿真配置，输出 SVG、帧序列或可复现实验状态。
- `diagram_expand`：继续负责题目内容里的围栏展开，确保 Web/PDF 路径一致。

### 数据格式

首版继续使用：

````text
```primebrush
primebrush:
  type: geometry_2d
  ...
```
````

未来可扩展：

````text
```sim_canvas
sim_canvas:
  type: electric_field
  ...
```
````

保存策略：题目中保存源围栏；导出或 Web 展示时生成 `resource/<library>/image/*.svg|*.png`。

## 里程碑

### M0：题库内可用教育绘图面板

- 后端新增 PrimeBrush 即时渲染 API。
- 题库编辑器新增“绘图”入口。
- 首批模板覆盖：平面几何、函数图像、统计图、化学结构式。
- 插入结果仍是 `primebrush` 围栏，兼容现有导出流水线。

### M1：通用教育绘图边栏

- 抽出可复用边栏组件，不再只属于题库编辑器。
- 支持最近图稿、模板收藏、复制源 YAML、插入当前位置。
- 支持从已有 `primebrush` 围栏反向打开编辑。
- 将图稿元数据纳入项目级素材索引，方便复用。

### M2：学科图插件扩展

优先顺序建议：

1. `physics_force`：受力分析图、斜面、绳/杆、弹簧、摩擦力、分解箭头。
2. `physics_circuit`：初高中电路图，电源、电阻、电表、开关、节点标注。
3. `optics_ray`：平面镜、透镜、折射、反射、光路追迹示意。
4. `geography_contour`：等高线、剖面线、河流/山脊/山谷标注。
5. `chemistry_lattice`：晶胞、离子晶格、简单空间堆积示意。

### M3：SimCanvas 教学仿真

- 电场/磁场/引力场线：源点、密度、颜色、场强相对值。
- 基础力学：小车、斜面、抛体、简谐振动的参数化示意。
- 电路半仿真：简单串并联等效、表计读数、开关状态。
- 输出优先 SVG 快照，再考虑动画帧和 WASM 交互。

### M4：助手协同与素材生态

- 助手根据题干自动建议插图类型和初稿 YAML。
- 从知识点推荐常用图式模板。
- 图稿可打包随题库交换 ZIP 流转。
- 为每个插件补用户手册、示例 SVG、失败提示和 golden 测试。

## 验收标准

- 教师能在不手写完整 YAML 的情况下插入一张可导出的教学图。
- 同一图稿在编辑器预览、题目预览、PDF 导出中语义一致。
- 未实现图类返回清晰错误，不产生空白图或静默失败。
- 每个新增图类至少包含：模型定义、渲染插件、示例、单测、帮助文档。

## 风险与边界

- 不把首版做成通用绘图软件，先满足高频教学图。
- 不把 SimCanvas 承诺为工程级仿真器，默认定位为课堂示意。
- SVG 预览应尽量通过图片上下文展示，避免直接注入未审查 SVG。
- 学科插件扩展前要先稳定图稿 schema，减少后续题库迁移成本。
