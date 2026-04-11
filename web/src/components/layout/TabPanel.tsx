import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export type TabItem = {
  id: string;
  label: string;
  dirty?: boolean;
  closable?: boolean;
};

type Props = {
  tabs: TabItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onCloseOthers?: () => void;
  className?: string;
};

export function TabPanel({ tabs, activeId, onSelect, onClose, onCloseOthers, className }: Props) {
  if (tabs.length === 0) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex min-h-9 shrink-0 items-stretch gap-0 overflow-x-auto border-b border-slate-200 bg-white",
        className,
      )}
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={cn(
              "group flex min-w-0 max-w-[14rem] items-center border-b-2 border-transparent px-2 py-1.5 text-left text-xs font-medium transition-colors",
              active ? "border-slate-900 bg-slate-50 text-slate-900" : "text-slate-600 hover:bg-slate-50",
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => onSelect(tab.id)}
              title={tab.label}
            >
              {tab.dirty ? <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" aria-hidden /> : null}
              <span className="align-middle">{tab.label}</span>
            </button>
            {tab.closable !== false && onClose ? (
              <button
                type="button"
                className="ml-0.5 shrink-0 rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100"
                aria-label="关闭"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
      {onCloseOthers && tabs.length > 1 ? (
        <button
          type="button"
          className="ml-auto shrink-0 px-2 text-[10px] text-slate-500 hover:text-slate-800"
          onClick={onCloseOthers}
        >
          关闭其他
        </button>
      ) : null}
    </div>
  );
}
