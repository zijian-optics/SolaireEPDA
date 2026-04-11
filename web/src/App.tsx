import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  BookMarked,
  BookOpen,
  FileStack,
  Layers,
  Network,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { AgentSidebar } from "./components/AgentSidebar";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { MenuBar } from "./components/layout/MenuBar";
import { ToolBar } from "./components/layout/ToolBar";
import { AgentProvider, useAgentContext } from "./contexts/AgentContext";
import { ToolBarProvider, useToolBar } from "./contexts/ToolBarContext";
import { AnalysisWorkspace } from "./pages/AnalysisWorkspace";
import { HelpWorkspace } from "./pages/HelpWorkspace";
import { LogWorkspace } from "./pages/LogWorkspace";
import { SettingsWorkspace } from "./pages/SettingsWorkspace";
import { WelcomePage } from "./pages/WelcomePage";
import { apiGet, apiPost } from "./api/client";
import { dispatchSolaireSave } from "./lib/saveEvents";
import { cn } from "./lib/utils";
import { isTauriShell } from "./lib/tauriEnv";
import type { AppPage } from "./app/appPages";
import { BankRoute, ComposeRoute, GraphRoute, TemplateRoute } from "./app/routes";
import type { ProjectInfo } from "./types/project";

export default function App() {
  return (
    <AgentProvider>
      <ToolBarProvider>
        <AppShell />
      </ToolBarProvider>
    </AgentProvider>
  );
}

function AppShell() {
  const { t } = useTranslation(["app", "common", "welcome"]);
  const { toggleSidebar, sidebarOpen, setSidebarOpen } = useAgentContext();
  const { left: toolBarLeft, right: toolBarRight } = useToolBar();
  const [page, setPage] = useState<AppPage>("compose");
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const refreshInfo = useCallback(async () => {
    try {
      setErr(null);
      const i = await apiGet<ProjectInfo>("/api/project/info");
      setInfo(i);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshInfo();
  }, [refreshInfo]);

  useEffect(() => {
    if (!info?.bound) {
      setSidebarOpen(false);
    }
  }, [info?.bound, setSidebarOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        dispatchSolaireSave();
      }
      if (e.key === "Escape" && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, setSidebarOpen]);

  const openProjectPicker = useCallback(async () => {
    setErr(null);
    try {
      const w = typeof window !== "undefined" ? window : undefined;
      const isTauri =
        w &&
        ("__TAURI_INTERNALS__" in w ||
          (w as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined);
      if (isTauri) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const sel = await open({ directory: true, multiple: false, title: t("welcome:pickFolderTitle") });
        const path = Array.isArray(sel) ? sel[0] : sel;
        if (typeof path === "string" && path) {
          await apiPost("/api/project/open", { root: path });
          await refreshInfo();
        }
      } else {
        await apiPost("/api/project/pick-open", {});
        await refreshInfo();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        !msg.includes("取消") &&
        !msg.includes("未选择") &&
        !/cancel/i.test(msg)
      ) {
        setErr(msg);
      }
    }
  }, [refreshInfo, t]);

  const closeProject = useCallback(async () => {
    setErr(null);
    try {
      await apiPost("/api/project/close", {});
      await refreshInfo();
      setPage("compose");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [refreshInfo]);

  const openRecentPath = useCallback(
    async (path: string) => {
      setErr(null);
      try {
        await apiPost("/api/project/open", { root: path });
        await refreshInfo();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshInfo],
  );

  return (
    <div
      className={cn(
        "flex h-screen min-h-0 flex-col bg-slate-50 text-slate-900",
        isTauriShell() && "box-border overflow-hidden rounded-lg",
      )}
    >
      <DesktopTitleBar
        menu={
          isTauriShell() && info?.bound ? (
            <MenuBar
              variant="titlebar"
              projectRoot={info.root}
              onNewProject={() => setNewProjectOpen(true)}
              onOpenProject={() => void openProjectPicker()}
              onOpenRecentPath={openRecentPath}
              onCloseProject={() => void closeProject()}
              onFileSave={() => dispatchSolaireSave()}
              onPreferences={() => setPage("settings")}
              onGoWelcome={() => void closeProject()}
              setPage={setPage}
              toggleAssistant={() => toggleSidebar()}
            />
          ) : undefined
        }
      />

      <div className="relative flex min-h-0 flex-1">
        {!info?.bound ? (
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <WelcomePage onProjectReady={() => void refreshInfo()} onError={(msg) => setErr(msg)} />
          </div>
        ) : (
          <>
            <aside className="flex w-[4.25rem] shrink-0 flex-col border-r border-slate-800 bg-slate-900">
              <nav className="flex flex-1 flex-col gap-1 p-2">
                <div className="flex flex-1 flex-col gap-1">
                  <SidebarNavButton
                    icon={Network}
                    label={t("app:nav.graph")}
                    active={page === "graph"}
                    onClick={() => setPage("graph")}
                  />
                  <SidebarNavButton
                    icon={BookMarked}
                    label={t("app:nav.bank")}
                    active={page === "bank"}
                    onClick={() => setPage("bank")}
                  />
                  <SidebarNavButton
                    icon={FileStack}
                    label={t("app:nav.template")}
                    active={page === "template"}
                    onClick={() => setPage("template")}
                  />
                  <SidebarNavButton
                    icon={Layers}
                    label={t("app:nav.compose")}
                    active={page === "compose"}
                    onClick={() => setPage("compose")}
                  />
                  <SidebarNavButton
                    icon={BarChart3}
                    label={t("app:nav.analysis")}
                    active={page === "analysis"}
                    onClick={() => setPage("analysis")}
                    title={t("app:nav.analysisTitle")}
                  />
                  <SidebarNavButton
                    icon={Sparkles}
                    label={t("app:nav.assistant")}
                    active={sidebarOpen}
                    onClick={() => toggleSidebar()}
                    title={t("app:nav.assistantTitle")}
                  />
                </div>
                <div className="mt-auto flex flex-col gap-1 border-t border-slate-800 pt-2">
                  <SidebarNavButton
                    icon={BookOpen}
                    label={t("app:nav.help")}
                    active={page === "help"}
                    onClick={() => setPage("help")}
                    title={t("app:nav.helpTitle")}
                  />
                  <SidebarNavButton
                    icon={ScrollText}
                    label={t("app:nav.log")}
                    active={page === "log"}
                    onClick={() => setPage("log")}
                    title={t("app:nav.logTitle")}
                  />
                </div>
              </nav>
            </aside>

            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
              {!isTauriShell() ? (
                <MenuBar
                  projectRoot={info.root}
                  onNewProject={() => setNewProjectOpen(true)}
                  onOpenProject={() => void openProjectPicker()}
                  onOpenRecentPath={openRecentPath}
                  onCloseProject={() => void closeProject()}
                  onFileSave={() => dispatchSolaireSave()}
                  onPreferences={() => setPage("settings")}
                  onGoWelcome={() => void closeProject()}
                  setPage={setPage}
                  toggleAssistant={() => toggleSidebar()}
                />
              ) : null}
              <NewProjectDialog
                open={newProjectOpen}
                onOpenChange={setNewProjectOpen}
                onProjectReady={() => void refreshInfo()}
                onError={setErr}
              />

              <ToolBar left={toolBarLeft} right={toolBarRight} />

              {err && (
                <div
                  className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5"
                  role="alert"
                >
                  <p className="min-w-0 flex-1 truncate text-sm leading-snug text-red-800">{err}</p>
                  <span className="shrink-0 whitespace-nowrap text-xs text-red-600/90">
                    {t("app:errorBannerLogHint")}
                  </span>
                </div>
              )}

              <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  {info?.bound && (
                    <div
                      className={cn(
                        "h-full min-h-0 min-w-0 overflow-hidden",
                        page !== "compose" && "hidden",
                      )}
                      aria-hidden={page !== "compose"}
                    >
                      <ComposeRoute info={info} onRefreshInfo={refreshInfo} onError={setErr} />
                    </div>
                  )}
                  {page === "bank" && (
                    <BankRoute
                      info={info}
                      onRefreshInfo={refreshInfo}
                      onError={setErr}
                      onOpenGraphNode={(nodeId) => {
                        setGraphFocusNodeId(nodeId);
                        setPage("graph");
                      }}
                    />
                  )}
                  {page === "template" && <TemplateRoute info={info} onRefreshInfo={refreshInfo} onError={setErr} />}
                  {page === "graph" && (
                    <GraphRoute
                      info={info}
                      onRefreshInfo={refreshInfo}
                      onError={setErr}
                      focusNodeId={graphFocusNodeId}
                      onFocusConsumed={() => setGraphFocusNodeId(null)}
                    />
                  )}
                  {page === "settings" && (
                    <SettingsWorkspace
                      onError={setErr}
                      onSwitchProject={async () => {
                        await refreshInfo();
                        setPage("compose");
                      }}
                    />
                  )}
                  {page === "help" && <HelpWorkspace onError={setErr} />}
                  {page === "analysis" && <AnalysisWorkspace />}
                  {page === "log" && <LogWorkspace />}
                </main>
                <AgentSidebar projectBound mode="overlay" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SidebarNavButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
  title,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[10px] font-medium transition-colors",
        disabled && "cursor-not-allowed opacity-40",
        !disabled && !active && "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
        active && "bg-slate-800 text-white shadow-inner",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
      <span className="leading-tight">{label}</span>
    </button>
  );
}
