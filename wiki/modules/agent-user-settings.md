# 智能助手模型与安全策略：本机与项目

## 合并顺序（生效值）

1. 运行后端进程的环境变量（`SOLAIRE_LLM_*` / `OPENAI_*`）
2. **本机用户目录**下的 `agent/llm_overrides.json`（未打开项目时在欢迎页/设置中保存）
3. **当前项目**下 `.solaire/agent/llm_overrides.json`（打开项目后保存；**同名项覆盖本机与环境**）

访问密钥、服务地址、模型服务类型（`provider`）、主/快模型、`max_tokens` 均按上述顺序叠加。

## 模型服务类型（provider）

| 值 | 运行时说明 |
|----|------------|
| `openai` | 使用 OpenAI **Responses API**（非 Chat Completions） |
| `anthropic` | 使用 Anthropic **Messages API** |
| `openai_compat` | 使用 OpenAI SDK 的 **Chat Completions** 兼容路径（默认，与历史版本一致） |
| `deepseek` | 兼容路径；未指定服务地址时默认 `https://api.deepseek.com` |

合并文件中可保存字符串字段 `provider`（与设置页「模型服务」对应）。

环境变量 `SOLAIRE_LLM_PROVIDER` 与密钥变量 `SOLAIRE_LLM_API_KEY`、`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 的优先级见 `docs/api/agent.md`。

| 平台 | 默认根目录 |
|------|------------|
| Windows | `%APPDATA%\SolEdu` |
| macOS | `~/Library/Application Support/SolEdu` |
| Linux | `$XDG_CONFIG_HOME/solaire` 或 `~/.config/solaire` |

其下 `agent/llm_overrides.json`、`agent/safety_mode.json` 由后端读写。测试或自定义根目录可设环境变量 **`SOLAIRE_USER_CONFIG_DIR`**。

## HTTP 接口

见仓库 `docs/api/agent.md` 中 `GET`/`PUT` `/api/agent/llm-settings` 与 `safety-mode`；响应字段 `persist_scope` 为 `global` 时表示写入本机，`project` 时表示写入当前项目。
