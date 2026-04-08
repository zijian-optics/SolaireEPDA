import { apiPost, ensureApiBase } from "../api/client";
import { pickFolderCanceledMessage } from "./pickFolder";

function isTauriWindow(): boolean {
  const w = typeof window !== "undefined" ? window : undefined;
  if (!w) return false;
  return (
    "__TAURI_INTERNALS__" in w || (w as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined
  );
}

/**
 * 在本机选择文件夹或可执行文件（Tauri 用系统对话框；浏览器模式由后端弹出对话框）。
 */
export async function pickHostPath(
  mode: "dir" | "file",
  titles?: { dir?: string; file?: string },
): Promise<string | null> {
  if (isTauriWindow()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    if (mode === "dir") {
      const sel = await open({
        directory: true,
        multiple: false,
        title: titles?.dir ?? "选择文件夹",
      });
      const path = Array.isArray(sel) ? sel[0] : sel;
      return typeof path === "string" && path ? path : null;
    }
    const sel = await open({
      multiple: false,
      title: titles?.file ?? "选择程序文件",
      filters: [
        { name: "可执行文件", extensions: ["exe"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    const path = Array.isArray(sel) ? sel[0] : sel;
    return typeof path === "string" && path ? path : null;
  }
  await ensureApiBase();
  try {
    const r = await apiPost<{ ok: boolean; path: string }>("/api/system/extensions/pick-path", {
      dialog: mode,
    });
    return r.path ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (pickFolderCanceledMessage(msg) || msg.includes("未选择") || msg.includes("已取消")) {
      return null;
    }
    throw e;
  }
}
