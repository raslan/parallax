import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A settings/controls panel that collapses to a one-line summary bar and
 * expands into a block **in normal flow** — expanding pushes the sibling
 * content (a virtualized grid) down rather than floating over it, so the
 * grid never gets hidden and its live updates stay visible. The page shell
 * owns the single scroll region (`overflow-hidden` + the grid's own
 * `flex-1 min-h-0`), so a taller panel just means a shorter grid viewport,
 * not a second scrollbar. Collapsed/expanded state persists per page via
 * `storageKey`.
 */
export function CollapsibleControls({
  storageKey,
  summary,
  children,
}: {
  storageKey: string;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? true : stored === "open";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch {
      // ignore
    }
  }, [storageKey, open]);

  return (
    <div className="shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-left hover:border-primary/50 hover:bg-primary/15 transition-colors"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-primary transition-transform",
            open && "-rotate-180",
          )}
        />
        <div className="flex-1 min-w-0 text-xs font-medium text-foreground truncate">{summary}</div>
      </button>

      {open && (
        <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card">
          {children}
        </div>
      )}
    </div>
  );
}
