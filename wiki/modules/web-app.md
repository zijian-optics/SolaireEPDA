# 模块：Web 前端

## 主目录

- `web/`：Vite + React + TypeScript

## 常见入口

- **页面与交互**：`web/src/pages/`
- **应用壳与路由切换**：`web/src/App.tsx`
- **API 封装**：`web/src/api/client.ts`
- **桌面环境检测**：`web/src/lib/tauriEnv.ts` 等

## 协作注意

- 与后端通过 `/api/*` 通信；错误处理需与 `{"detail": ...}` 约定一致。
- 国际化：贡献流程要求注意 i18n（见根目录 `README.md`）。

## 相关

- [backend-web.md](backend-web.md)
- [desktop-tauri.md](desktop-tauri.md)
