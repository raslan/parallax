import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/Tip";
import { formatSize } from "@/lib/format";

/**
 * The bulk-action bar for a selection: pinned to the bottom of the viewport
 * (clear of the mobile tab bar) while anything is selected, so the actions stay
 * in reach however far the list is scrolled. Pass the page's actions as children.
 */
export function SelectionBar({
  count,
  bytes,
  summary,
  onClear,
  children,
}: {
  count: number;
  /** Combined size of the selection, shown beside the count when known. */
  bytes?: number;
  /** What the action will do to the selection (e.g. "→ 15 GB −59%"), between the count and the buttons. */
  summary?: ReactNode;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Selection actions"
      className="fixed inset-x-4 bottom-20 z-30 flex animate-slide-up-fade md:inset-x-auto md:left-1/2 md:w-max md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-xl md:bottom-6 md:flex-nowrap md:whitespace-nowrap"
    >
      <span className="text-sm font-medium tabular-nums" role="status">
        {count} selected{bytes ? ` · ${formatSize(bytes)}` : ""}
      </span>
      {summary}
      {children}
      <Tip label="Clear the selection (files are not touched)">
        <Button size="sm" variant="ghost" onClick={onClear} className="px-2">
          <X className="mr-1 h-3.5 w-3.5" />
          Clear
        </Button>
      </Tip>
    </div>
  );
}
