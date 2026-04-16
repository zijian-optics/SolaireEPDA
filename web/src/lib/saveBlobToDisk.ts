import { isTauriShell } from "./tauriEnv";

export type SaveFilter = { name: string; extensions: string[] };

export type SaveBlobOptions = {
  defaultFileName: string;
  title?: string;
  filters?: SaveFilter[];
};

/**
 * 将 Blob 写入磁盘：
 * - Tauri 壳内：弹出系统「另存为」对话框，用户选择位置后写入；取消返回 `false`。
 * - 浏览器模式：沿用 `<a download>` 触发浏览器内置下载（落至下载目录），返回 `true`。
 *
 * 浏览器里 `<a.click()` 在 Tauri webview 中不会触发下载，因而桌面端必须走原生对话框 + 原生写盘。
 */
export async function saveBlobToDisk(blob: Blob, options: SaveBlobOptions): Promise<boolean> {
  if (isTauriShell()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const target = await save({
      defaultPath: options.defaultFileName,
      title: options.title,
      filters: options.filters,
    });
    if (!target) return false;
    const path = typeof target === "string" ? target : String(target);
    const buf = new Uint8Array(await blob.arrayBuffer());
    await invoke("save_bytes_to_file", { path, bytes: Array.from(buf) });
    return true;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = options.defaultFileName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
