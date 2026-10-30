import { ListChecks, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSize } from "@/lib/format";

export interface SmartSelectOption {
  id: string;
  label: string;
  /** Tooltip / longer explanation of what the shortcut picks. */
  hint?: string;
  count: number;
  /** Combined current size of the files it picks. */
  bytes: number;
  /** Combined estimated size after the operation, when the page can estimate one. */
  estBytes?: number;
  /** True while the page's selection is exactly this set. */
  active: boolean;
  onSelect: () => void;
}

/**
 * Selection shortcuts that show what they would pick before you click: how many
 * files, how big, and (on pages that can estimate) what they'd shrink to. The
 * choice stays with the user — this only puts the numbers next to it.
 */
export function SmartSelect({ options }: { options: SmartSelectOption[] }) {
  const shown = options.filter((o) => o.count > 0);
  if (shown.length === 0) return null;
  return (
    <div
      className="flex shrink-0 gap-2 overflow-x-auto pb-1"
      role="group"
      aria-label="Quick selections"
    >
      {shown.map((o) => {
        const pct =
          o.estBytes !== undefined && o.bytes > 0
            ? Math.round(((o.bytes - o.estBytes) / o.bytes) * 100)
            : null;
        return (
          <button
            key={o.id}
            type="button"
            onClick={o.onSelect}
            title={o.hint}
            aria-pressed={o.active}
            className={cn(
              "shrink-0 rounded-lg border px-3 py-2 text-left transition-colors",
              o.active
                ? "border-primary bg-primary/10"
                : "border-border bg-px-surface hover:border-primary/50",
            )}
          >
            <div className="mb-0.5 flex items-center gap-1 text-2xs text-primary/80">
              <ListChecks className="h-3 w-3" />
              Select all that are
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{o.label}</span>
              <span className="text-2xs tabular-nums text-muted-foreground">
                {o.count} file{o.count !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-2xs tabular-nums text-muted-foreground">
              <span>{formatSize(o.bytes)}</span>
              {o.estBytes !== undefined && (
                <>
                  <span aria-hidden>→</span>
                  <span className="text-foreground/80">{formatSize(o.estBytes)}</span>
                </>
              )}
              {pct !== null && pct > 0 && (
                <span className="flex items-center gap-0.5 font-mono text-green-400">
                  <TrendingDown className="h-3 w-3" />-{pct}%
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
