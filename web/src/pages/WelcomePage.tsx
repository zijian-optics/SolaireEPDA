import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Boxes, Cpu, Info, LayoutGrid } from "lucide-react";
import welcomeLogo from "../assets/welcome-logo.png";
import { AgentSidebar } from "../components/AgentSidebar";
import { ExtensionsPanel } from "../components/ExtensionsPanel";
import { ModelConfigPane } from "../components/welcome/ModelConfigPane";
import { cn } from "../lib/utils";
import { IntroPane } from "./welcome/IntroPane";
import { ProjectPane } from "./welcome/ProjectPane";

type WelcomeTab = "intro" | "project" | "model" | "extensions";

const tabs: { id: WelcomeTab; icon: typeof Info; labelKey: string }[] = [
  { id: "intro", icon: Info, labelKey: "sidebarIntro" },
  { id: "project", icon: LayoutGrid, labelKey: "sidebarProject" },
  { id: "model", icon: Cpu, labelKey: "sidebarModel" },
  { id: "extensions", icon: Boxes, labelKey: "sidebarExtensions" },
];

type Props = {
  onProjectReady: () => void;
  onError: (msg: string | null) => void;
};

export function WelcomePage({ onProjectReady, onError }: Props) {
  const { t } = useTranslation(["welcome", "app"]);
  const [tab, setTab] = useState<WelcomeTab>("intro");

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
      <aside className="flex w-[min(22%,280px)] shrink-0 flex-col border-r border-slate-700/80 bg-slate-950/50 p-4">
        <div className="mb-6 flex flex-col gap-3 border-b border-slate-700/60 pb-4">
          <div className="flex max-w-[10rem] items-center justify-center rounded-xl p-2">
            <img src={welcomeLogo} alt="" className="h-auto w-full object-contain object-center" aria-hidden />
          </div>
          <p className="text-xs font-semibold leading-snug tracking-tight text-slate-100">{t("welcome:brand")}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  active ? "bg-indigo-600/40 text-white shadow-inner ring-1 ring-indigo-500/30" : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-100",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={1.75} />
                {t(`welcome:${item.labelKey}` as const)}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2 border-t border-slate-700/60 pt-4 text-[10px] leading-relaxed text-slate-500">
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          {t("welcome:hint2")}
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <AgentSidebar projectBound={false} mode="overlay" />
        <header className="shrink-0 border-b border-slate-700/50 px-8 py-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t("welcome:title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">{t("welcome:subtitle")}</p>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
          {tab === "intro" && <IntroPane />}
          {tab === "project" && <ProjectPane onProjectReady={onProjectReady} onError={onError} />}
          {tab === "model" && <ModelConfigPane onError={onError} />}
          {tab === "extensions" && (
            <div className="max-h-full max-w-2xl overflow-auto rounded-xl border border-slate-600/60 bg-white p-4 text-slate-900 shadow-lg">
              <ExtensionsPanel onError={onError} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
