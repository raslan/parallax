import { ScanSearch } from "lucide-react";
import { ProgressBar } from "@/components/ProgressBar";

/**
 * Shown in place of an empty state while a background extraction/scan job is
 * actually running, so "nothing found" doesn't read as a false negative while
 * work is still in flight. Used by Duplicates, ImageDuplicates and
 * ContentReview.
 *
 * `progress` null → indeterminate shimmer bar; a number → a determinate
 * percentage bar.
 */
export function WorkingState({
  title,
  message,
  progress,
}: {
  title: string;
  message: string;
  progress?: number | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-8 py-16 flex flex-col items-center text-center gap-4">
      <div className="flex items-center gap-2">
        <ScanSearch className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-lg">{title}</h3>
      </div>

      {progress != null ? (
        <>
          <div className="text-3xl font-bold font-mono tabular-nums tracking-tight">
            {Math.round(progress)}%
          </div>
          <ProgressBar value={progress} label={title} className="max-w-xs" />
        </>
      ) : (
        <ProgressBar value={null} label={title} className="w-40" />
      )}

      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
    </div>
  );
}
