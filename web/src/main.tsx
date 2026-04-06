import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ensureApiBase } from "./api/client";
import { initI18n } from "./i18n/i18n";
import { readStoredLocale, tauriGetLocale, writeStoredLocale, type AppLang } from "./i18n/tauriLocale";
import { installGlobalLogging } from "./lib/appLog";
import { isTauriShell } from "./lib/tauriEnv";
import "./index.css";

if (typeof document !== "undefined" && isTauriShell()) {
  document.documentElement.classList.add("tauri-shell");
}

installGlobalLogging();

void (async () => {
  const fromTauri = await tauriGetLocale();
  let lng: AppLang = "zh";
  if (fromTauri) {
    lng = fromTauri;
    writeStoredLocale(fromTauri);
  } else {
    const stored = readStoredLocale();
    lng = stored ?? (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("en") ? "en" : "zh");
  }
  await initI18n(lng);
  try {
    await ensureApiBase();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const title =
      lng === "en" ? "Could not reach the local service" : "无法连接本地服务";
    const root = document.getElementById("root");
    if (root) {
      root.innerHTML = `<div style="padding:24px;font-family:system-ui,sans-serif;line-height:1.5;max-width:520px"><p style="font-weight:600;margin-bottom:8px">${title}</p><p style="color:#444;font-size:14px">${msg.replace(/</g, "&lt;")}</p></div>`;
    }
    return;
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
})();
