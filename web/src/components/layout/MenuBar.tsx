import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { apiGet } from "../../api/client";
import { cn } from "../../lib/utils";
import type { AppPage } from "../../app/appPages";

type RecentItem = { name: string; path: string; last_opened: string };

type Props = {
  /** 桌面壳标题栏内嵌：与系统窗口按钮同一行，深色紧凑样式 */
  variant?: "default" | "titlebar";
  projectRoot: string | null;
  onNewProject: () => void;
  onOpenProject: () => void;
  onOpenRecentPath: (path: string) => Promise<void>;
  onCloseProject: () => void;
  onFileSave: () => void;
  onPreferences: () => void;
  onGoWelcome: () => void;
  setPage: (p: AppPage) => void;
  toggleAssistant: () => void;
};

const MenuDropdownCloseContext = createContext<(() => void) | null>(null);

function MenuDropdown({
  label,
  children,
  align = "left",
  variant = "default",
}: {
  label: string;
  children: ReactNode;
  align?: "left" | "right";
  variant?: "default" | "titlebar";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (!root) return;

    /** 捕获阶段 + composedPath：避免 WebView 下冒泡/目标节点异常导致「点外部不收起」 */
    const onPointerDownCapture = (e: PointerEvent) => {
      const path = e.composedPath();
      if (path.includes(root)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => void document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={cn(
          "[-webkit-app-region:no-drag] [app-region:no-drag] transition-colors duration-150",
          variant === "titlebar"
            ? "flex items-center gap-0.5 rounded px-2 py-0.5 text-xs font-medium text-slate-200 hover:bg-slate-800/60"
            : "flex items-center gap-0.5 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-100/90",
          open && (variant === "titlebar" ? "bg-slate-800 text-slate-100" : "bg-slate-100"),
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {label}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            variant === "titlebar" ? "opacity-70" : "opacity-60",
          )}
        />
      </button>
      {open ? (
        <MenuDropdownCloseContext.Provider value={close}>
          <div
            role="menu"
            className={cn(
              "absolute top-full z-[100] mt-0.5 min-w-[12rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg",
              align === "right" ? "right-0" : "left-0",
            )}
          >
            {children}
          </div>
        </MenuDropdownCloseContext.Provider>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const closeDropdown = useContext(MenuDropdownCloseContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="block w-full px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-40"
      onClick={() => {
        onClick();
        closeDropdown?.();
      }}
    >
      {children}
    </button>
  );
}

export function MenuBar({
  variant = "default",
  projectRoot,
  onNewProject,
  onOpenProject,
  onOpenRecentPath,
  onCloseProject,
  onFileSave,
  onPreferences,
  onGoWelcome,
  setPage,
  toggleAssistant,
}: Props) {
  const { t } = useTranslation("app");
  const [recent, setRecent] = useState<RecentItem[]>([]);

  const loadRecent = useCallback(async () => {
    try {
      const data = await apiGet<{ items: RecentItem[] }>("/api/recent-projects");
      setRecent(data.items ?? []);
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const openRecent = async (path: string) => {
    try {
      await onOpenRecentPath(path);
    } catch {
      /* parent sets error */
    }
  };

  const nav = (
    <nav className={cn("flex items-center gap-0.5", variant === "titlebar" ? "h-full px-0" : "flex-1 px-1")}>
        <MenuDropdown label={t("menu.file")} variant={variant}>
          <MenuItem onClick={onNewProject}>{t("menu.fileNew")}</MenuItem>
          <MenuItem onClick={onOpenProject}>{t("menu.fileOpen")}</MenuItem>
          <div className="my-1 border-t border-slate-100" role="separator" />
          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{t("menu.fileRecent")}</div>
          {recent.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-slate-400">{t("menu.fileRecentEmpty")}</div>
          ) : (
            recent.map((r) => (
              <MenuItem key={r.path} onClick={() => void openRecent(r.path)}>
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block truncate text-[10px] text-slate-500">{r.path}</span>
              </MenuItem>
            ))
          )}
          <div className="my-1 border-t border-slate-100" role="separator" />
          <MenuItem onClick={onFileSave} disabled={!projectRoot}>
            {t("menu.fileSave")}
          </MenuItem>
          <MenuItem onClick={onPreferences}>{t("menu.filePreferences")}</MenuItem>
          <MenuItem onClick={onCloseProject} disabled={!projectRoot}>
            {t("menu.fileCloseProject")}
          </MenuItem>
          <MenuItem onClick={onGoWelcome}>{t("menu.fileWelcome")}</MenuItem>
        </MenuDropdown>
        <MenuDropdown label={t("menu.view")} variant={variant}>
          <MenuItem onClick={() => setPage("graph")}>{t("nav.graph")}</MenuItem>
          <MenuItem onClick={() => setPage("bank")}>{t("nav.bank")}</MenuItem>
          <MenuItem onClick={() => setPage("template")}>{t("nav.template")}</MenuItem>
          <MenuItem onClick={() => setPage("compose")}>{t("nav.compose")}</MenuItem>
          <MenuItem onClick={() => setPage("analysis")}>{t("nav.analysis")}</MenuItem>
          <div className="my-1 border-t border-slate-100" role="separator" />
          <MenuItem onClick={() => setPage("help")}>{t("nav.help")}</MenuItem>
          <MenuItem onClick={() => setPage("log")}>{t("nav.log")}</MenuItem>
          <div className="my-1 border-t border-slate-100" role="separator" />
          <MenuItem onClick={toggleAssistant}>{t("menu.viewAssistant")}</MenuItem>
        </MenuDropdown>
    </nav>
  );

  if (variant === "titlebar") {
    return (
      <div className="flex h-full min-h-0 shrink-0 items-center gap-1 border-0 bg-transparent text-slate-200">
        {nav}
      </div>
    );
  }

  return <header className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 py-1">{nav}</header>;
}
