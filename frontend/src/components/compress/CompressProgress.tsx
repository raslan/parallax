import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Compress job progress / result banner. The page owns the `jobId != null`
 * mount guard; this just renders the box given the poll state.
 */
export function CompressProgress({
  isRunning,
  isDone,
  jobStatus,
  jobProgress,
  jobCurrentFile,
  jobError,
  startError,
  onCancel,
}: {
  isRunning: boolean;
  isDone: boolean;
  jobStatus: string | null;
  jobProgress: number;
  jobCurrentFile: string | null;
  jobError: string | null;
  startError: string | null;
  onCancel: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 space-y-2 max-w-2xl",
        isDone && jobStatus === "completed"
          ? "border-green-500/30 bg-green-500/5"
          : isDone
            ? "border-red-500/30 bg-red-500/5"
            : "border-primary/30 bg-primary/5",
      )}
    >
      <div className="flex items-center gap-3">
        {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
        <span className="text-sm font-medium flex-1">
          {jobStatus === "completed"
            ? "Compression complete"
            : jobStatus === "cancelled"
              ? "Cancelled"
              : jobStatus === "failed"
                ? "Compression failed"
                : jobCurrentFile
                  ? `Compressing: ${jobCurrentFile}`
                  : "Starting…"}
        </span>
        {isRunning && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-7 px-2 text-muted-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${jobProgress}%` }}
        />
      </div>
      {(jobError || startError) && <p className="text-xs text-red-400">{jobError || startError}</p>}
    </div>
  );
}
