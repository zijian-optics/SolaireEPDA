import { isTauriShell } from "./tauriEnv";

export async function confirmDialog(message: string, title?: string): Promise<boolean> {
  if (isTauriShell()) {
    try {
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      return Boolean(await confirm(message, title ? { title } : undefined));
    } catch {
      /* Fall back to the browser dialog below. */
    }
  }
  return window.confirm(message);
}
