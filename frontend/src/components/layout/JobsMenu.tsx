import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Square } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { JobRadialIcon } from "./JobRadialIcon";
import { useJobsFeed } from "@/hooks/useJobsFeed";
import { api, qk } from "@/lib/api";
import type { Job } from "@/types/job";
import { formatDate } from "@/lib/format";
import { StatusDot } from "@/components/StatusDot";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  scan: "Scan",
  transcode: "Transcode",
  duplicates: "Duplicate scan",
  subtitle_download: "Subtitle download",
  subtitle_sync: "Subtitle sync",
  whisper_transcribe: "Whisper transcription",
  model_download: "Model download",
  compress: "Compress",
  toolbox_fix: "Toolbox fix",
  thumbnail_warm: "Generating thumbnails",
};
const label = (t: string) => TYPE_LABEL[t] ?? t;
const isActive = (s: string) => s === "running" || s === "pending";

const DOT: Record<string, "running" | "idle" | "done" | "error"> = {
  running: "running",
  pending: "idle",
  completed: "done",
  cancelled: "idle",
  failed: "error",
};

/** @public */
export function JobsMenu() {
  const [open, setOpen] = useState(false);
  const [listRef] = useAutoAnimate<HTMLDivElement>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeCount, aggregateProgress } = useJobsFeed();

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(),
  });
  const active = jobs.filter((j) => isActive(j.status));
  const recent = jobs.filter((j) => !isActive(j.status)).slice(0, 8);

  const openJob = (id: number) => {
    setOpen(false);
    navigate(`/jobs?focus=${id}`);
  };

  const viewAll = () => {
    setOpen(false);
    navigate("/jobs");
  };

  const cancel = async (id: number) => {
    try {
      await api.cancelJob(id);
      queryClient.invalidateQueries({ queryKey: qk.jobs() });
    } catch {
      /* surfaced on the jobs page */
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Jobs${activeCount ? ` (${activeCount} active)` : ""}`}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      >
        <JobRadialIcon progress={aggregateProgress} count={activeCount} />
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))]">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Jobs</span>
        </div>
        <div ref={listRef} className="max-h-[70vh] overflow-y-auto p-1">
          {jobs.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No jobs yet.</p>
          )}

          {active.length > 0 && (
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Active
            </p>
          )}
          {active.map((j) => (
            <button
              key={j.id}
              onClick={() => openJob(j.id)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-[hsl(var(--sidebar-accent))]"
            >
              <StatusDot status={DOT[j.status] ?? "running"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{label(j.type)}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {j.total_files > 0
                    ? `${j.processed_files} / ${j.total_files} · ${Math.round(j.progress)}%`
                    : `${Math.round(j.progress)}%`}
                </span>
              </span>
              <span
                role="button"
                tabIndex={0}
                title="Stop this job"
                onClick={(e) => {
                  e.stopPropagation();
                  cancel(j.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    cancel(j.id);
                  }
                }}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Square className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}

          {recent.length > 0 && (
            <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Recent
            </p>
          )}
          {recent.map((j) => (
            <button
              key={j.id}
              onClick={() => openJob(j.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-[hsl(var(--sidebar-accent))]",
                j.status === "failed" && "text-destructive",
              )}
            >
              <StatusDot status={DOT[j.status] ?? "error"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{label(j.type)}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {j.status} · {formatDate(j.created_at)}
                </span>
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={viewAll}
          className="block w-full border-t px-3 py-2 text-center text-xs text-primary hover:underline"
        >
          View all jobs →
        </button>
      </PopoverContent>
    </Popover>
  );
}
