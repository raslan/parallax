import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { searchSummary } from "@/lib/subtitleSearchJob";
import type { Job } from "@/types/job";

const ENDED: Record<string, string> = {
  completed: "",
  cancelled: "Cancelled · ",
  failed: "Failed · ",
};

/** "14:32" in the viewer's own clock. */
function timeOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * One line on the Subtitles Home view: the newest search of the open folder, once it has
 * ended (a running or waiting one is in Activity), with a way to open its matches. Read from the
 * jobs list, so it goes away when that job leaves it (Clear history). Props-in/callbacks-out.
 */
export function LastSearch({ job, onOpen }: { job: Job | null; onOpen: (jobId: number) => void }) {
  if (!job || !(job.status in ENDED)) return null;
  const at = timeOf(job.finished_at ?? job.created_at);
  return (
    <section
      aria-label="Last search"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm"
    >
      <History className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-xs text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">Last search</span>
        {at && ` · ${at}`} · {ENDED[job.status]}
        {searchSummary(job)}
      </span>
      <Button size="sm" variant="outline" className="shrink-0 px-2" onClick={() => onOpen(job.id)}>
        Show the matches
      </Button>
    </section>
  );
}
