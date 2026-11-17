import { Link } from "react-router";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ProgressBar";
import { SectionHeader } from "@/components/SectionHeader";
import { jobLabel } from "@/lib/jobs";
import { baseName } from "@/lib/path";
import type { ActiveJob } from "@/types/subtitle";

/**
 * The Activity section of the Subtitles page: every subtitle job started from the open
 * folder (or a folder inside it), with progress, the file being worked on, a Cancel, and
 * for a job waiting behind other work its place in the queue with a link to Jobs. Rebuilt
 * from the server, so it survives a reload and shows work started on another device.
 * Renders nothing while no work runs. Props-in/callbacks-out.
 */
export function ActivityBar({
  jobs,
  cancelling,
  onCancel,
  onOpenRun,
  onOpenMatches,
}: {
  jobs: ActiveJob[];
  cancelling: ReadonlySet<number>;
  onCancel: (id: number) => void;
  /** Opens a subtitle download's run view (its per-title progress and results). */
  onOpenRun?: (id: number) => void;
  /** Opens a subtitle search's Matches view, as far as it has got. */
  onOpenMatches?: (id: number) => void;
}) {
  if (jobs.length === 0) return null;
  return (
    <section
      aria-label="Activity"
      className="space-y-2 rounded-lg border border-border bg-card p-3"
    >
      <SectionHeader>Activity · {jobs.length}</SectionHeader>
      <ul className="space-y-2">
        {jobs.map((j) => {
          const label = jobLabel(j.type);
          const waiting = j.status === "pending";
          return (
            <li key={j.id} className="flex items-center gap-3 text-sm">
              {waiting ? (
                <span className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 font-medium">{label}</span>
                  {waiting ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {j.queue_position != null
                        ? `Waiting for another job, position ${j.queue_position}`
                        : "Waiting to start"}
                      {" · "}
                      <Link to="/jobs" className="underline hover:text-foreground">
                        Jobs
                      </Link>
                    </span>
                  ) : (
                    j.current_file && (
                      <span
                        className="truncate font-mono text-xs text-muted-foreground"
                        title={j.current_file}
                      >
                        {baseName(j.current_file)}
                      </span>
                    )
                  )}
                </div>
                {!waiting && (
                  <div className="flex items-center gap-2">
                    <ProgressBar
                      value={j.progress}
                      label={`${label} progress`}
                      className="flex-1"
                    />
                    <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums">
                      {Math.round(j.progress)}%
                    </span>
                  </div>
                )}
              </div>
              {onOpenMatches && j.type === "subtitle_search" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenMatches(j.id)}
                  className="shrink-0 px-2"
                >
                  Show the matches
                </Button>
              )}
              {onOpenRun && j.type === "subtitle_download" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenRun(j.id)}
                  className="shrink-0 px-2"
                >
                  Show the run
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onCancel(j.id)}
                disabled={cancelling.has(j.id)}
                aria-label={`Cancel ${label}`}
                className="shrink-0 px-2"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Cancel
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
