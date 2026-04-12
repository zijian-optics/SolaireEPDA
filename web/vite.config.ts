import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /** 供 pdf.js worker 的 `?url` 导入解析到包内构建产物 */
      "pdfjs-dist/build/pdf.worker.min.mjs": path.resolve(
        "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
