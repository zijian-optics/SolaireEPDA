import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function ToolBar({
  left,
  right,
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  if (left == null && right == null) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex min-h-[2.5rem] shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{left}</div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</div>
    </div>
  );
}
