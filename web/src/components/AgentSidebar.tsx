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
    /**
     * 收起时仅移出视区、保持挂载，以保留对话与流式任务状态；不设全屏蒙层，主工作区始终可操作。
     */
    return (
      <div className="pointer-events-none absolute inset-0 z-[40]">
        <aside
          className={cn(
            "absolute bottom-0 right-0 top-0 z-[40] flex max-h-full w-[min(22rem,100%)] max-w-full min-w-0 flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200 ease-out",
            sidebarOpen
              ? "pointer-events-auto translate-x-0"
              : "pointer-events-none translate-x-full",
          )}
          aria-hidden={!sidebarOpen}
        >
          <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
            <AgentChatPanel projectBound={projectBound} onRequestCollapse={() => setSidebarOpen(false)} />
          </div>
        </aside>
      </div>
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
