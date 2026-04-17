import { useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AgentChatPanel } from "./AgentChatPanel";
import { useAgentContext } from "../contexts/AgentContext";
import { cn } from "../lib/utils";

export function AgentSidebar({
  projectBound = false,
  mode = "overlay",
  overlayHost = null,
}: {
  projectBound?: boolean;
  /** dock：与主区并排；overlay：覆盖在右侧，不挤压主区宽度 */
  mode?: "dock" | "overlay";
  overlayHost?: HTMLElement | null;
}) {
  const { sidebarOpen, setSidebarOpen } = useAgentContext();
  const [overlayStyle, setOverlayStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (mode !== "overlay" || !overlayHost || typeof window === "undefined") {
      setOverlayStyle(null);
      return;
    }

    const updateOverlayStyle = () => {
      const rect = overlayHost.getBoundingClientRect();
      const width = Math.min(352, Math.max(rect.width, 0));
      setOverlayStyle({
        position: "fixed",
        top: rect.top,
        right: Math.max(window.innerWidth - rect.right, 0),
        width,
        height: rect.height,
      });
    };

    updateOverlayStyle();

    const resizeObserver = new ResizeObserver(() => updateOverlayStyle());
    resizeObserver.observe(overlayHost);
    window.addEventListener("resize", updateOverlayStyle);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateOverlayStyle);
    };
  }, [mode, overlayHost]);

  if (mode === "overlay") {
    if (!overlayHost || !overlayStyle) return null;

    return createPortal(
      <aside
        style={overlayStyle}
        className={cn(
          "z-[40] flex min-w-0 max-w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out",
          sidebarOpen
            ? "translate-x-0"
            : "pointer-events-none translate-x-full",
        )}
        aria-hidden={!sidebarOpen}
      >
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
          <AgentChatPanel projectBound={projectBound} onRequestCollapse={() => setSidebarOpen(false)} />
        </div>
      </aside>,
      document.body,
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 overflow-hidden border-l border-slate-200 bg-white transition-[width] duration-200 ease-out",
        sidebarOpen ? "w-[22rem]" : "w-0 min-w-0",
      )}
      aria-hidden={!sidebarOpen}
    >
      <div className="flex h-full min-h-0 w-[22rem] min-w-[22rem] flex-col">
        <AgentChatPanel projectBound={projectBound} onRequestCollapse={() => setSidebarOpen(false)} />
      </div>
    </div>
  );
}
