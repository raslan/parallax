import { useId, useState } from "react";
import { areaPaths, cumulativeSaved } from "@/lib/dashboard";
import { formatSize } from "@/lib/format";
import type { StatsPoint } from "@/types/stats";

const W = 600;
const H = 160;

function formatBucket(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Cumulative space saved across the window, with a hover read-out per bucket. */
export function SavingsChart({ points }: { points: readonly StatsPoint[] }) {
  const gradId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const values = cumulativeSaved(points);

  if (points.length < 2) {
    return (
      <p className="flex h-40 items-center text-sm text-muted-foreground">
        A curve appears once there is activity on at least two days.
      </p>
    );
  }

  const { line, area, points: xy } = areaPaths(values, W, H);
  const active =
    hover == null ? null : { point: points[hover]!, total: values[hover]!, at: xy[hover]! };

  return (
    <div>
      <div
        className="relative"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          setHover(
            Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))),
          );
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Space saved over time, reaching ${formatSize(values[values.length - 1] ?? 0)}`}
          className="h-40 w-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--px-accent)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--px-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradId})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--px-accent)"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {active && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-px bg-primary/50"
              style={{ left: `${(active.at.x / W) * 100}%` }}
            />
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `clamp(15%, ${(active.at.x / W) * 100}%, 85%)` }}
            >
              <p className="font-mono font-semibold tabular-nums">{formatSize(active.total)}</p>
              <p className="text-muted-foreground">{formatBucket(active.point.t)}</p>
            </div>
          </>
        )}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{formatBucket(points[0]!.t)}</span>
        <span>{formatBucket(points[points.length - 1]!.t)}</span>
      </div>
    </div>
  );
}
