import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useCountUp } from "@/hooks/useCountUp";
import { deltaPct, formatDurationWords, savedShare, splitSize } from "@/lib/dashboard";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StatsSummary } from "@/types/stats";

/**
 * The page's one loud element: how much space has been recovered, drawn as what went
 * in versus what came out. The hatched stretch of the bar is the space that was freed.
 */
export function SavedHero({
  summary,
  previousSaved,
  rangeLabel,
}: {
  summary: StatsSummary;
  /** Savings in the equally long window before this one; null when unknown. */
  previousSaved: number | null;
  rangeLabel: string;
}) {
  const saved = Math.max(0, summary.bytes_saved);
  const animated = useCountUp(saved);
  const { value, unit } = splitSize(animated);
  const share = savedShare(summary.bytes_in, summary.bytes_out);
  const delta = previousSaved == null ? null : deltaPct(saved, previousSaved);

  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <section
      aria-labelledby="saved-heading"
      className="rounded-xl border border-border bg-px-surface p-6 md:p-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h2 id="saved-heading" className="text-sm text-muted-foreground">
            Space saved · {rangeLabel.toLowerCase()}
          </h2>
          <p className="mt-2 flex items-baseline gap-2 font-mono tabular-nums tracking-tight">
            <span className="text-6xl font-bold leading-none text-primary md:text-7xl">
              {value}
            </span>
            <span className="text-2xl font-medium text-muted-foreground md:text-3xl">{unit}</span>
          </p>
        </div>

        {delta !== null && delta !== 0 && (
          <p
            className={cn(
              "flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm tabular-nums",
              delta > 0 ? "border-primary/40 text-primary" : "border-border text-muted-foreground",
            )}
          >
            {delta > 0 ? (
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            ) : (
              <ArrowDownRight className="h-4 w-4" aria-hidden />
            )}
            {Math.abs(delta)}% {delta > 0 ? "more" : "less"} than the previous{" "}
            {rangeLabel.toLowerCase()}
          </p>
        )}
      </div>

      {summary.bytes_in > 0 ? (
        <div className="mt-8">
          <div
            role="img"
            aria-label={`${formatSize(summary.bytes_in)} processed, ${formatSize(summary.bytes_out)} remain`}
            className="relative h-4 overflow-hidden rounded-full border border-border"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, color-mix(in srgb, var(--px-accent) 55%, transparent) 0 3px, transparent 3px 7px)",
            }}
          >
            <div
              className="absolute inset-0 origin-left bg-px-elevated transition-transform duration-1000 ease-out"
              style={{ transform: `scaleX(${drawn ? 1 - share : 1})` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span className="tabular-nums">
              {formatSize(summary.bytes_in)} went in, {formatSize(summary.bytes_out)} came out
            </span>
            <span className="tabular-nums">{Math.round(share * 100)}% smaller</span>
          </div>
        </div>
      ) : (
        <p className="mt-6 max-w-prose text-sm text-muted-foreground">
          Nothing compressed in this window yet. Run Compress on a library and the before and after
          sizes will be drawn here.
        </p>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-border pt-6 sm:grid-cols-4">
        <Fact label="Jobs finished" value={summary.jobs_completed.toLocaleString()} />
        <Fact label="Files processed" value={summary.files.toLocaleString()} />
        <Fact
          label="Media transcoded"
          value={summary.media_seconds > 0 ? formatDurationWords(summary.media_seconds) : "—"}
        />
        <Fact label="Time spent working" value={formatDurationWords(summary.busy_seconds)} />
      </dl>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
