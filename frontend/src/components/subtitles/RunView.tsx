import { Link } from "react-router";
import { CheckCircle2, Loader2, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ProgressBar";
import { SectionHeader } from "@/components/SectionHeader";
import { baseName } from "@/lib/path";
import { languageName } from "@/lib/subtitle-langs";
import type { RunEntry, RunItem } from "@/types/subtitle";

const ACTIVE = new Set(["pending", "running"]);

function statusLine(status: string, queuePosition: number | null, error: string | null) {
  if (status === "pending")
    return queuePosition != null
      ? `Waiting for another job, position ${queuePosition}`
      : "Waiting to start";
  if (status === "running") return "Downloading";
  if (status === "completed") return "Finished";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return error ? `Failed: ${error}` : "Failed";
  return status;
}

/**
 * A "Find subtitles" run: per-title progress and results read from the job (so a reload or
 * another device rebuilds it), Cancel while it runs (the rest are skipped), and for each
 * failed item Retry (that item again, as a new run) and Pick another (the Compare sheet).
 * Props-in/callbacks-out.
 */
export function RunView({
  entries,
  titleOf,
  status,
  currentFile,
  queuePosition,
  error,
  cancelling,
  retrying,
  comparing,
  onCancel,
  onRetry,
  onCompare,
}: {
  /** The item whose "Pick another" search is running: its button waits. */
  comparing: RunItem | null;
  /** A retry is being submitted: Retry waits so a double click cannot queue two jobs. */
  retrying: boolean;
  entries: RunEntry[];
  titleOf: (videoPath: string) => { key: string; name: string };
  status: string;
  currentFile: string | null;
  queuePosition: number | null;
  error: string | null;
  cancelling: boolean;
  onCancel: () => void;
  onRetry: (item: RunItem) => void;
  /** Opens the Compare sheet for an item (Task 14). */
  onCompare: (item: RunItem) => void;
}) {
  const active = ACTIVE.has(status);
  const titles = new Map<string, { name: string; entries: RunEntry[] }>();
  for (const e of entries) {
    const t = titleOf(e.item.video_path);
    const g = titles.get(t.key) ?? { name: t.name, entries: [] };
    g.entries.push(e);
    titles.set(t.key, g);
  }
  const failed = entries.filter((e) => e.state === "failed");
  const notes = entries.filter((e) => e.result?.sync_error || e.result?.cleanup_error);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
        {active ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium" role="status">
          {statusLine(status, queuePosition, error)}
        </span>
        {status === "pending" && (
          <Link
            to="/jobs"
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Jobs
          </Link>
        )}
        {status === "running" && currentFile && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {currentFile}
          </span>
        )}
        {active && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={onCancel}
            disabled={cancelling}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
        )}
      </div>

      <ul className="space-y-2">
        {[...titles].map(([key, t]) => {
          const n = (s: RunEntry["state"]) => t.entries.filter((e) => e.state === s).length;
          const done = t.entries.length - n("waiting");
          const parts = [`${n("saved")} saved`];
          if (n("failed")) parts.push(`${n("failed")} failed`);
          if (n("skipped")) parts.push(`${n("skipped")} skipped`);
          if (n("waiting")) parts.push(`${n("waiting")} to go`);
          return (
            <li key={key} className="space-y-1 rounded-lg border border-border bg-card p-3">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{t.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {parts.join(" · ")}
                </span>
              </div>
              <ProgressBar
                value={(done / Math.max(t.entries.length, 1)) * 100}
                label={`${t.name}: ${done} of ${t.entries.length} done`}
              />
            </li>
          );
        })}
      </ul>

      {failed.length > 0 && (
        <section className="space-y-2">
          <SectionHeader>Failed · {failed.length}</SectionHeader>
          {active && (
            <p className="text-3xs text-muted-foreground">
              Retry and Pick another work once this run has ended.
            </p>
          )}
          <ul className="space-y-1.5">
            {failed.map((e) => {
              const label = `${baseName(e.item.video_path)} ${languageName(e.item.language)}`;
              const searching =
                comparing?.video_path === e.item.video_path &&
                comparing.language === e.item.language;
              return (
                <li
                  key={`${e.item.video_path}:${e.item.language}`}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono">{baseName(e.item.video_path)}</span>
                    <span className="text-muted-foreground">
                      {languageName(e.item.language)}
                      {e.result?.error ? " · " : ""}
                    </span>
                    {e.result?.error && <span className="text-destructive">{e.result.error}</span>}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={active || retrying}
                    aria-label={`Retry ${label}`}
                    onClick={() => onRetry(e.item)}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Retry
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    disabled={active || searching}
                    aria-busy={searching || undefined}
                    aria-label={`Pick another for ${label}`}
                    onClick={() => onCompare(e.item)}
                  >
                    {searching ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Search className="mr-1 h-3 w-3" />
                    )}
                    Pick another
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {notes.length > 0 && (
        <section className="space-y-1">
          <SectionHeader>Saved, with a note · {notes.length}</SectionHeader>
          <ul className="space-y-1 text-xs">
            {notes.map((e) => (
              <li key={`${e.item.video_path}:${e.item.language}`} className="text-muted-foreground">
                <span className="font-mono">{baseName(e.item.video_path)}</span>{" "}
                {languageName(e.item.language)}: {e.result?.sync_error ?? e.result?.cleanup_error}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
