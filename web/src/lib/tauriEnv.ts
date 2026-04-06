/** 是否在 Tauri 桌面壳内运行（用于区分浏览器开发调试）。 */
export function isTauriShell(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in w || w.__TAURI__ !== undefined;
}

/**
 * 冷启动时脚本可能比 Tauri 注入 `__TAURI__` 更早执行，导致首次误判为「非壳」。
 * 仅在需要时轮询，避免把 API 基址永久锁成空字符串。
 */
export async function waitForTauriShell(maxMs: number): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isTauriShell()) return true;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 16));
    if (isTauriShell()) return true;
  }
  return false;
}
