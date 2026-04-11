import { AgentChatPanel } from "./AgentChatPanel";
import { useAgentContext } from "../contexts/AgentContext";
import { cn } from "../lib/utils";

export function AgentSidebar({
  projectBound = false,
  mode = "overlay",
}: {
  projectBound?: boolean;
  /** dock：与主区并排；overlay：覆盖在右侧，不挤压主区宽度 */
  mode?: "dock" | "overlay";
}) {
  const { sidebarOpen, setSidebarOpen } = useAgentContext();

  if (mode === "overlay") {
    return (
      <>
        {sidebarOpen ? (
          <button
            type="button"
            className="absolute inset-0 z-[35] bg-slate-900/20 lg:hidden"
            aria-label="关闭助手"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}
        <aside
          className={cn(
            "absolute bottom-0 right-0 top-0 z-[40] flex overflow-hidden border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out",
            sidebarOpen ? "w-[min(22rem,calc(100vw-4.25rem))] translate-x-0" : "w-[min(22rem,calc(100vw-4.25rem))] translate-x-full pointer-events-none",
          )}
          aria-hidden={!sidebarOpen}
        >
          <div className="flex h-full w-full min-w-0 flex-col">
            <AgentChatPanel projectBound={projectBound} onRequestCollapse={() => setSidebarOpen(false)} />
          </div>
        </aside>
      </>
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
      <div className="flex h-full w-full min-w-0 flex-col">
        <AgentChatPanel projectBound={projectBound} onRequestCollapse={() => setSidebarOpen(false)} />
      </div>
    </div>
  );
}
