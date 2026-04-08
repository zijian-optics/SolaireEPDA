import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauriShell } from "./tauriEnv";

/** 在桌面壳内用系统默认浏览器打开链接；开发浏览器中用 window.open。 */
export async function openExternalUrl(url: string): Promise<void> {
  const u = url.trim();
  if (!u) return;
  if (isTauriShell()) {
    await openUrl(u);
    return;
  }
  window.open(u, "_blank", "noopener,noreferrer");
}
