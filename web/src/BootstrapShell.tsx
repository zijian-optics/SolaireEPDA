import { StrictMode, useEffect, useState } from "react";
import App from "./App";
import { ensureApiBase } from "./api/client";
import i18n from "./i18n/i18n";

type Phase = "loading" | "ready" | "error";

/**
 * 桌面壳内：先完成本地服务握手再进入主界面；浏览器开发环境不走此分支。
 */
export function BootstrapShell() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureApiBase();
        if (!cancelled) setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMessage(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "loading") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, sans-serif",
          color: "#334155",
          fontSize: 15,
        }}
      >
        {i18n.t("connectingLocalService", { ns: "common" })}
      </div>
    );
  }

  if (phase === "error" && errorMessage) {
    const title = i18n.t("couldNotReachLocalService", { ns: "common" });
    return (
      <div
        style={{
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          lineHeight: 1.5,
          maxWidth: 520,
        }}
      >
        <p style={{ fontWeight: 600, marginBottom: 8 }}>{title}</p>
        <p style={{ color: "#444", fontSize: 14 }}>
          {errorMessage.replace(/</g, "\u003c")}
        </p>
      </div>
    );
  }

  return (
    <StrictMode>
      <App />
    </StrictMode>
  );
}
