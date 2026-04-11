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
     * 仅在打开时挂载侧栏与蒙层。关闭时若保留白底 aside + translate-x-full，在部分 WebView 下
     * 仍可能露出一条白边或挤压 flex 视觉区域；不挂载则不占绘制、不参与布局。
     */
    return (
      <div className="pointer-events-none absolute inset-0 z-[40]">
        {sidebarOpen ? (
          <>
            <button
              type="button"
              className="pointer-events-auto absolute inset-0 z-[35] bg-slate-900/20 lg:bg-slate-900/10"
              aria-label="关闭助手"
              onClick={() => setSidebarOpen(false)}
            />
            <aside
              className="pointer-events-auto absolute bottom-0 right-0 top-0 z-[40] flex max-h-full w-[min(22rem,100%)] max-w-full min-w-0 flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl"
              aria-hidden={false}
            >
              <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
                <AgentChatPanel projectBound={projectBound} onRequestCollapse={() => setSidebarOpen(false)} />
              </div>
            </aside>
          </>
        ) : null}
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
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        {sidebarOpen ? (
          <AgentChatPanel projectBound={projectBound} onRequestCollapse={() => setSidebarOpen(false)} />
        ) : null}
      </div>
    </div>
  );
}
