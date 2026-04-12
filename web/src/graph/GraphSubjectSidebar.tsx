import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GraphInfo } from "../api/client";
import { cn } from "../lib/utils";

interface Props {
  graphs: GraphInfo[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  onCreateGraph: (displayName: string) => Promise<void>;
  onDeleteGraph: (slug: string) => Promise<void>;
  onRenameGraph: (slug: string, newName: string) => Promise<void>;
  busy?: boolean;
}

export function GraphSubjectSidebar({
  graphs,
  activeSlug,
  onSelect,
  onCreateGraph,
  onDeleteGraph,
  onRenameGraph,
  busy,
}: Props) {
  const { t } = useTranslation("graph");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await onCreateGraph(newName.trim());
    setNewName("");
    setCreating(false);
  };

  const startRename = (g: GraphInfo) => {
    setRenamingSlug(g.slug);
    setRenameValue(g.display_name);
  };

  const commitRename = async () => {
    if (!renamingSlug || !renameValue.trim()) {
      setRenamingSlug(null);
      return;
    }
    await onRenameGraph(renamingSlug, renameValue.trim());
    setRenamingSlug(null);
  };

  return (
    <aside className="flex w-[min(100%,200px)] shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("graphsTitle")}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {graphs.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-400">{t("noGraphsHint")}</p>
        ) : (
          <ul className="space-y-px p-1.5">
            {graphs.map((g) => (
              <li key={g.slug}>
                {renamingSlug === g.slug ? (
                  <div className="flex items-center gap-1 px-1 py-0.5">
                    <input
                      className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-xs"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename();
                        if (e.key === "Escape") setRenamingSlug(null);
                      }}
                      onBlur={() => void commitRename()}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={cn(
                      "group flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors",
                      activeSlug === g.slug
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100",
                    )}
                    onClick={() => onSelect(g.slug)}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{g.display_name}</span>
                    <span
                      className={cn(
                        "ml-1 shrink-0 rounded px-1 text-[10px]",
                        activeSlug === g.slug
                          ? "bg-white/20 text-white"
                          : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {g.node_count}
                    </span>
                    <span
                      className={cn(
                        "ml-1 hidden shrink-0 rounded px-1 text-[10px] group-hover:inline",
                        activeSlug === g.slug ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-slate-700",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(g);
                      }}
                    >
                      ✎
                    </span>
                    {graphs.length > 1 ? (
                      <span
                        className={cn(
                          "ml-0.5 hidden shrink-0 rounded px-1 text-[10px] group-hover:inline",
                          activeSlug === g.slug ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-red-600",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(t("confirmDeleteGraph", { name: g.display_name }))) {
                            void onDeleteGraph(g.slug);
                          }
                        }}
                      >
                        ✕
                      </span>
                    ) : null}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-slate-100 p-2">
        {creating ? (
          <div className="flex flex-col gap-1.5">
            <input
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
              placeholder={t("newGraphNamePh")}
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape") { setCreating(false); setNewName(""); }
              }}
            />
            <div className="flex gap-1">
              <button
                type="button"
                className="flex-1 rounded bg-slate-900 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                disabled={busy || !newName.trim()}
                onClick={() => void handleCreate()}
              >
                {t("create")}
              </button>
              <button
                type="button"
                className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
                onClick={() => { setCreating(false); setNewName(""); }}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="w-full rounded border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700"
            onClick={() => setCreating(true)}
          >
            + {t("newGraph")}
          </button>
        )}
      </div>
    </aside>
  );
}
