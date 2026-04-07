

# SolEdu

**AI 驱动的 K12 教育自动化平台**  
组卷 · 题库 · 知识图谱 · 学情分析 · 智能助手

[安装](#安装) · [本地编译](#本地编译) · [功能](#功能概览) · [路线图](#未来计划) · [贡献](#贡献) · [许可证](#许可证)

---

## 简介

**SolEdu** 是一个面向 K12 教育的开源自动化平台，灵感来自光电子电子设计自动化（EPDA）的理念——通过标准化工具链和自动化流水线，将组卷、题库管理、知识图谱维护、学情分析等高度重复的教学事务，提升到工程级水准。

围绕教师核心工作流形成持续闭环：

```
备课 → 组卷 → 考试 → 分析 → 改进 → 备课
```

内置的 AI 智能助手贯穿各业务环节，将教师从重复事务中解放出来，回归教学设计与课堂互动。

## 功能概览


| 能力域      | 说明                                                                |
| -------- | ----------------------------------------------------------------- |
| **试卷编译** | ExamCompiler然您从题库选题、模板组卷，一键导出学生版/教师版 PDF，轻松、简单、高效、标准              |
| **题库管理** | KnowledgeForge实现了题库 CRUD、标签筛选、导入/导出（YAML 与 ZIP 交换包），轻松与其他老师分享您的题库 |
| **知识图谱** | AxiomGraph模块知识点关系可视化编辑，题目与知识点双向关联，为您的教学提供灵感                       |
| **学情分析** | EduAnalysis为考试结果提供了多维诊断（班级/学生/知识点），自定义脚本扩展                        |
| **教育绘图** | PrimeBrush提供声明式配置生成平面几何、函数图、统计图等高清矢量图                             |
| **智能助手** | 内嵌AI助手Solaire，助您一键组卷、分析、图谱等全业务场景（需要API-KEY）                       |


支持 **Web 端** 和 **Windows 桌面端**（基于 Tauri）。

## 版本说明

### 社区版（当前版本）

本仓库即社区版，以 **AGPL-3.0** 协议开源，包含上述全部核心功能模块。适用于：

- 个人教师独立使用
- 学校内部部署与二次开发
- 教育技术爱好者研究与贡献

### 商业版（未来计划）

面向学校和教育机构提供的商业授权版本，将在社区版基础上增加：

- 多用户与权限管理
- SaaS 云端部署与私有部署
- 官方题库与精品模板
- 企业级技术支持与 SLA 保障
- 闭源授权选项
- 其他高级功能

企业版相关信息将在后续公布，敬请关注。

## 安装

### 下载安装包

前往 [GitHub Releases](https://github.com/zijian-optics/SolaireEPDA/releases) 下载最新版本：


| 平台      | 格式     | 说明        |
| ------- | ------ | --------- |
| Windows | `.msi` | 双击安装，开箱即用 |


> 其他平台支持正在规划中。

## 本地编译

### 环境要求

- [**Pixi**](https://pixi.sh/latest/)（统一管理 Python / Node / Rust，无需单独安装三者）
- **Git**
- **Visual Studio Build Tools**（含 MSVC，Rust 链接原生代码必需）
- **TeX 发行版**（TeX Live 或 MiKTeX）— 导出 PDF 必需；`latexmk` 与 `xelatex` 需在 PATH 中

### 1. 克隆并初始化

```powershell
git clone https://github.com/zijian-optics/SolaireEPDA
cd SolaireEPDA
pixi install
pixi run bootstrap
```

`pixi run bootstrap` 会在项目内环境安装全部 Python 和前端依赖（首次约 3–5 分钟）。

### 2. 开发模式

```powershell
pixi run dev
```

启动 Tauri 窗口、Vite 前端（`http://127.0.0.1:5173`）和 Uvicorn 后端（`http://127.0.0.1:8000`）。

### 3. 桌面版打包

```powershell
pixi run build-desktop
```

产物位于 `src-tauri\target\release\bundle\msi\`。详细说明与常见问题见 [docs/desktop-build.md](docs/desktop-build.md)。

## 未来计划

- **扩展绘图**：三维图形、物理绘图、化学晶格、地理等高线等（社区版规划）
- **证明验证器**：形式化验证基础数学推理 （社区版规划）
- **教案与课件**：从教学目标自动生成教案与课堂素材（社区版规划）
- **仿真画布**：简单物理场可视化仿真引擎 （商业版规划）
- **教师智能总览与学生中心**：统一呈现教学进度、薄弱点与改进成效，学生档案、个性化学习路径（商业版规划）
- **SaaS 部署**：多用户鉴权与云端服务（商业版规划）

## 贡献

我们欢迎所有形式的社区贡献！

### 提交 Issue

如果你发现了 Bug 或有功能建议，请 [提交 Issue](https://github.com/zijian-optics/SolaireEPDA/issues/new)。提交时请包含：

- 问题描述与复现步骤
- 运行环境信息（操作系统、Python 版本等）
- 相关日志或截图

### 提交 Pull Request

1. Fork 本仓库并创建特性分支
2. 确保代码通过现有测试：`pytest` 与 `cd web && npm test`, 并且进行了i18n国际化
3. 提交 PR 并描述你的改动
4. 在 solaire_doc中记录changelog

### 报告安全漏洞

如果你发现安全漏洞，**请勿通过公开 Issue 报告**。请发送邮件至 **[hectorzhang4253@gmail.com](mailto:security@YOUR_DOMAIN.com)**，我们会在确认后尽快修复并致谢。

### 贡献者许可协议（CLA）

为保障项目的长期健康发展，首次提交 PR 时需签署 [贡献者许可协议（CLA）](CLA.md)。CLA 不会改变你对自己代码的权利，仅确保项目可以持续以开源方式分发。

## 许可证

本项目基于 **[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)** 协议开源。

完整许可证文本见 [LICENSE](LICENSE) 文件。

---

