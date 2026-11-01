import { Loader2 } from "lucide-react";
import { Tip } from "@/components/Tip";

/**
 * Slim, non-blocking "details 312 / 1,409" indicator shown while file details
 * (duration, resolution, codec) stream in. Renders nothing once everything has
 * loaded. The bar is transform-based so progress glides instead of jumping.
 */
export function DetailsProgress({
  loaded,
  total,
  done,
}: {
  loaded: number;
  total: number;
  done: boolean;
}) {
  if (done || total === 0) return null;
  const fraction = Math.min(1, loaded / total);
  return (
    <Tip label="Reading duration, resolution and codec for each file. You can keep browsing.">
      <div
        role="progressbar"
        aria-label="Loading file details"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={loaded}
        className="flex animate-fade-in items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
        <span className="font-mono tabular-nums">
          details {loaded.toLocaleString()} / {total.toLocaleString()}
        </span>
        <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full w-full origin-left rounded-full bg-primary/80 transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${fraction})` }}
          />
        </div>
      </div>
    </Tip>
  );
}
