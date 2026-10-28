import { jobLabel } from "@/lib/jobs";
import { formatSize } from "@/lib/format";
import type { StatsBreakdownRow } from "@/types/stats";

/** Work by operation: bar length is job count, the figure is what that work freed. */
export function OperationBars({ rows }: { rows: readonly StatsBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No finished jobs in this window.</p>;
  }
  const top = [...rows].sort((a, b) => b.jobs - a.jobs).slice(0, 6);
  const max = Math.max(...top.map((r) => r.jobs), 1);
  return (
    <ul className="space-y-3">
      {top.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{jobLabel(r.key)}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {r.jobs} job{r.jobs === 1 ? "" : "s"}
              {r.bytes_saved > 0 && ` · ${formatSize(r.bytes_saved)} freed`}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full w-full origin-left bg-primary/70"
              style={{ transform: `scaleX(${r.jobs / max})` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
