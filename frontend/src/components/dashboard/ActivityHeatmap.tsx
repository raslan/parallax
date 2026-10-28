import type { HeatCell } from "@/lib/dashboard";

// Share of the theme accent per activity level; level 0 is the empty well.
const LEVEL_MIX = [0, 24, 46, 72, 100] as const;

function cellColor(level: HeatCell["level"]): string {
  return level === 0
    ? "hsl(var(--muted))"
    : `color-mix(in srgb, var(--px-accent) ${LEVEL_MIX[level]}%, hsl(var(--muted)))`;
}

/** One square per day for the last half year; busier days are closer to the accent. */
export function ActivityHeatmap({ cells }: { cells: readonly HeatCell[] }) {
  const total = cells.reduce((sum, c) => sum + c.jobs, 0);
  return (
    <div>
      <div
        role="img"
        aria-label={`${total} jobs over the last ${Math.round(cells.length / 7)} weeks`}
        className="grid grid-flow-col gap-[3px] overflow-x-auto pb-1"
        style={{ gridTemplateRows: "repeat(7, 12px)", gridAutoColumns: "12px" }}
      >
        {cells.map((c) => (
          <span
            key={c.date}
            title={`${c.date}: ${c.jobs} job${c.jobs === 1 ? "" : "s"}`}
            className="rounded-[3px]"
            style={{ gridColumn: c.col + 1, gridRow: c.row + 1, background: cellColor(c.level) }}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        Fewer
        {([0, 1, 2, 3, 4] as const).map((l) => (
          <span key={l} className="h-3 w-3 rounded-[3px]" style={{ background: cellColor(l) }} />
        ))}
        More
      </div>
    </div>
  );
}
