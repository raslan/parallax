import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSize } from "@/lib/format";

/**
 * The bulk-action bar for a selection: pinned to the bottom of the viewport
 * (clear of the mobile tab bar) while anything is selected, so the actions stay
 * in reach however far the list is scrolled. Pass the page's actions as children.
 */
export function SelectionBar({
  count,
  bytes,
  onClear,
  children,
}: {
  count: number;
  /** Combined size of the selection, shown beside the count when known. */
  bytes?: number;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Selection actions"
      className="fixed bottom-20 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-slide-up-fade items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 shadow-xl md:bottom-6"
    >
      <span className="text-sm font-medium tabular-nums" role="status">
        {count} selected{bytes ? ` · ${formatSize(bytes)}` : ""}
      </span>
      {children}
      <Button size="sm" variant="ghost" onClick={onClear} className="px-2">
        <X className="mr-1 h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}
