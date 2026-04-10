# SolEdu

**AI-powered K12 education automation platform**  
Exam assembly · Item bank · Knowledge graph · Learning analytics · Intelligent assistant

**Languages:** [简体中文](README.md) | English

[Install](#install) · [Build locally](#build-locally) · [Features](#features) · [Roadmap](#roadmap) · [Contributing](#contributing) · [License](#license)

---

## Overview

**SolEdu** is an open-source automation platform for K12 education, inspired by optoelectronic electronic design automation (EPDA)—through standardized toolchains and automated pipelines, it raises highly repetitive teaching tasks such as exam assembly, item-bank management, knowledge-graph maintenance, and learning analytics to an engineering-grade level.

It forms a continuous loop around core teacher workflows:

```
Prepare → Assemble exams → Test → Analyze → Improve → Prepare
```

A built-in AI assistant runs across these workflows, helping teachers step away from repetitive work and focus on instructional design and classroom interaction.

## Features


| Area | Description |
| -------- | ----------------------------------------------------------------- |
| **Exam compilation** | ExamCompiler lets you pick items from the bank and assemble papers from templates, then export student/teacher PDFs in one step—simple, efficient, and consistent |
| **Item bank** | KnowledgeForge provides full CRUD, tag filtering, and import/export (YAML and ZIP exchange packages) so you can share banks with colleagues easily |
| **Knowledge graph** | AxiomGraph offers visual editing of concept relationships and two-way links between items and concepts to support your teaching |
| **Learning analytics** | EduAnalysis provides multi-dimensional diagnostics (class, student, concept) with optional script extensions |
| **Educational graphics** | PrimeBrush generates high-resolution vector figures (plane geometry, function plots, statistics, and more) from declarative configuration |
| **Intelligent assistant** | Built-in assistant Solaire supports one-click workflows across exam assembly, analytics, graphs, and more (requires an API key) |


Available as **Web** and **Windows desktop** (Tauri).

## Editions

### Community edition (this repository)

This repo is the community edition, released under **AGPL-3.0**, including all core modules above. Suitable for:

- Individual teachers
- In-school deployment and customization
- EdTech enthusiasts who want to study or contribute

### Commercial edition (planned)

A commercially licensed edition for schools and institutions will add, on top of the community edition:

- Multi-user access and permissions
- SaaS cloud and private deployment
- Official item banks and premium templates
- Enterprise support and SLA
- Proprietary licensing options
- Other advanced capabilities

Further details will be announced later.

## Install

### Download installers

Get the latest release from [GitHub Releases](https://github.com/zijian-optics/SolaireEPDA/releases):


| Platform | Format | Notes |
| ------- | ------ | --------- |
| Windows | `.msi` | Double-click to install |


> Support for other platforms is planned.

## Build locally

### Prerequisites

- **[Pixi](https://pixi.sh/latest/)** (manages Python / Node / Rust together; no separate installs required)
- **Git**
- **Visual Studio Build Tools** (with MSVC; required for Rust native linking)
- **TeX distribution** (TeX Live or MiKTeX)—required for PDF export; `latexmk` and `xelatex` must be on `PATH`

### 1. Clone and bootstrap

```powershell
git clone https://github.com/zijian-optics/SolaireEPDA
cd SolaireEPDA
pixi install
pixi run bootstrap
```

`pixi run bootstrap` installs all Python and frontend dependencies in the project environment (first run may take about 3–5 minutes).

### 2. Development mode

```powershell
pixi run dev
```

This starts, in one terminal:

- **Backend**: Uvicorn at `http://127.0.0.1:8000` with `--reload`
- **Frontend**: Vite dev server at `http://localhost:5173` (matches `devUrl` in `tauri.conf.json`)
- **Desktop shell**: Tauri `tauri dev`

Orchestration is done by `scripts/dev-desktop.ps1` as Tauri’s `beforeDevCommand`; if something is still bound to `:8000`, the script tries to stop it before starting to avoid port conflicts.

For stable hot reload and restarts under `tauri dev`, the desktop shell does not enforce single-instance or tray hide-on-close in dev; release builds keep single-instance and tray behavior.

**Optional (debug separately)**: To run only backend or frontend, use another terminal with `pixi run dev-backend` or `pixi run dev-frontend`. Do not also run `pixi run dev`, or you may get port conflicts.

### 3. Clean and frontend build

```powershell
pixi run clean   # removes web/dist, src-tauri/target/release/bundle (installer output)
pixi run build   # production build under web/ (tsc + vite build)
```

Use `clean` / `build` when you need a static build before desktop dev; day-to-day development should use `pixi run dev` (Vite HMR; no need to `build` every time).

**Quality checks (optional)**: `pixi run test` (Python), `pixi run test-web` (frontend tests), `pixi run typecheck` (TypeScript).

### 4. Desktop packaging

```powershell
pixi run build-desktop
```

Output is under `src-tauri\target\release\bundle\msi\`. See [docs/desktop-build.md](docs/desktop-build.md) for details and troubleshooting.

## Roadmap

- **Richer drawing**: 3D graphics, physics diagrams, chemistry lattices, contour maps, and more (community)
- **Proof checker**: Formal verification for basic mathematical reasoning (community)
- **Lesson plans and slides**: Generate lesson plans and classroom materials from learning goals (community)
- **Simulation canvas**: Simple physics-field visualization (commercial)
- **Teacher dashboard and student hub**: Unified progress, gaps, and improvement; student profiles and personalized paths (commercial)
- **SaaS deployment**: Multi-user auth and cloud services (commercial)

## Contributing

We welcome community contributions in any form.

### Issues

For bugs or feature ideas, please [open an issue](https://github.com/zijian-optics/SolaireEPDA/issues/new). Include:

- Description and steps to reproduce
- Environment (OS, Python version, etc.)
- Logs or screenshots if helpful

### Pull requests

1. Fork the repo and create a feature branch
2. Make sure tests pass: `pixi run test` and `pixi run test-web`, and complete i18n where needed
3. Open a PR describing your changes
4. Record changelog in `src/solaire/web/assets/help_docs/changelog.md`

### Security

Please **do not** report security issues via public issues. Email **[hectorzhang4253@gmail.com](mailto:security@YOUR_DOMAIN.com)**; we will respond after verification and credit you appropriately.

### Contributor License Agreement (CLA)

First-time contributors need to sign the [Contributor License Agreement (CLA)](CLA.md). The CLA does not take away your rights to your code; it only allows the project to keep distributing it as open source.

## License

This project is licensed under **[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)**.

The full text is in [LICENSE](LICENSE).

---

