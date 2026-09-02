import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A settings/controls panel that collapses to a one-line summary bar and
 * expands into a floating overlay — never pushes sibling content (a
 * virtualized grid below it) down, since the expanded panel is positioned
 * absolutely over whatever's beneath it rather than growing the flex layout.
 * Collapsed/expanded state persists per page via `storageKey`.
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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch {
      // ignore
    }
  }, [storageKey, open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
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
        <div className="absolute top-full inset-x-0 z-20 mt-2 max-h-[75vh] overflow-y-auto rounded-lg border border-border bg-card/95 backdrop-blur-sm shadow-2xl">
          {children}
        </div>
      )}
    </div>
  );
}
