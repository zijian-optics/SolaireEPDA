# 模块：HTTP 服务与路由

## 主文件

- **`src/solaire/web/app.py`**：主 FastAPI 应用；图谱、组卷、题库等 REST 路由集中于此（含 `/api/graph/*` 等，以代码为准）。
- **`src/solaire/web/agent_api.py`**：智能助手相关接口，挂载前缀 **`/api/agent`**（SSE 等见该文件）。

## 约定

- API 统一走 **`/api/*`**。
- 错误返回常见：`{"detail":"..."}`。

## 相关

- [agent_layer.md](agent_layer.md)
- [knowledge_forge.md](knowledge_forge.md)
