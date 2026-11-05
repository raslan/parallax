import { Loader2 } from "lucide-react";
import { ProgressBar } from "@/components/ProgressBar";
import { Tip } from "@/components/Tip";

/**
 * Slim, non-blocking "details 312 / 1,409" indicator shown while file details
 * (duration, resolution, codec) stream in. Renders nothing once everything has
 * loaded. The bar is the shared `ProgressBar`.
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
  return (
    <Tip label="Reading duration, resolution and codec for each file. You can keep browsing.">
      <div className="flex animate-fade-in items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
        <span className="font-mono tabular-nums">
          details {loaded.toLocaleString()} / {total.toLocaleString()}
        </span>
        <ProgressBar
          value={(loaded / total) * 100}
          label="Loading file details"
          className="h-1 w-24"
          barClassName="bg-primary/80"
        />
      </div>
    </Tip>
  );
}
