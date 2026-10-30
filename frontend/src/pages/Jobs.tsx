import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Square,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api/client";
import { jobLabel } from "@/lib/jobs";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { Tip } from "@/components/Tip";
import { QueryError } from "@/components/QueryError";
import { ListSkeleton } from "@/components/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, qk } from "@/lib/api";
import type { Job, JobLog } from "@/types/job";
import { RelativeTime } from "@/components/RelativeTime";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusDot } from "@/components/StatusDot";
import { ProgressBar } from "@/components/ProgressBar";

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-blue-400" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-400" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
};

// Job types whose `current_file` is shown bare (a scan's file is just a name).
const BARE_FILE_TYPES = new Set(["scan", "audio_scan", "image_scan"]);

// Verb shown before `current_file`; anything unlisted reads "Processing".
const FILE_VERB: Record<string, string> = {
  duplicates: "Scanning",
  phash_scan: "Scanning",
  image_duplicates: "Scanning",
  image_content_scan: "Scanning",
  audio_duplicates: "Scanning",
  transcode: "Transcoding",
  compress: "Transcoding",
  audio_compress: "Transcoding",
  toolbox_fix: "Transcoding",
  splice_merge: "Transcoding",
  audio_toolbox: "Transcoding",
};

function JobProgress({ value }: { value: number }) {
  return (
    <div className="w-24 shrink-0">
      <ProgressBar
        value={value}
        label="Job progress"
        className="bg-px-elevated"
        barClassName="bg-linear-to-r from-(--px-accent) to-(--px-accent-secondary)"
      />
    </div>
  );
}

function JobRow({
  job,
  onCancel,
  focused = false,
}: {
  job: Job;
  onCancel?: (id: number) => void;
  focused?: boolean;
}) {
  const canCancel = (job.status === "running" || job.status === "pending") && onCancel;
  const isFinished =
    job.status === "completed" || job.status === "failed" || job.status === "cancelled";
  const rowRef = useRef<HTMLDivElement>(null);
  const [logsOpen, setLogsOpen] = useState(job.status === "failed" || focused);

  useEffect(() => {
    if (focused) {
      rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLogsOpen(true);
    }
  }, [focused]);

  const { data: logs = [], isLoading: logsLoading } = useQuery<JobLog[]>({
    queryKey: qk.jobLogs(job.id),
    queryFn: () => api.getJobLogs(job.id),
    enabled: logsOpen,
  });

  const toggleLogs = () => setLogsOpen((v) => !v);

  return (
    <div
      ref={rowRef}
      className={cn(
        "border-b last:border-0",
        focused &&
          "rounded-md ring-1 ring-primary ring-offset-2 ring-offset-background animate-pulse-ring",
      )}
    >
      <div className="flex items-center gap-4 py-3">
        <div className="shrink-0">{STATUS_ICON[job.status] ?? <Clock className="h-4 w-4" />}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{jobLabel(job.type)}</span>
            <Badge variant="secondary" className="text-xs capitalize">
              {job.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {job.status === "running" ? (
              <>
                <StatusDot status="running" />
                <p className="text-xs text-muted-foreground">
                  {`${job.processed_files} / ${job.total_files} files · ${Math.round(job.progress)}%`}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {`${job.processed_files} / ${job.total_files} files`}
              </p>
            )}
          </div>
          {job.status === "running" && job.current_file && (
            <p className="text-xs text-muted-foreground truncate" title={job.current_file}>
              {BARE_FILE_TYPES.has(job.type)
                ? job.current_file
                : `${FILE_VERB[job.type] ?? "Processing"}: ${job.current_file}`}
            </p>
          )}
          {job.error && (
            <p className="text-xs text-destructive truncate" title={job.error}>
              {job.error}
            </p>
          )}
        </div>

        {job.status === "running" && <JobProgress value={job.progress} />}

        {canCancel && (
          <Tip label="Stop this job">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label="Stop this job"
              onClick={() => onCancel(job.id)}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          </Tip>
        )}

        {isFinished && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            title="Show log"
            onClick={toggleLogs}
          >
            {logsOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </Button>
        )}

        <div className="text-xs text-muted-foreground shrink-0 text-right min-w-[100px]">
          <RelativeTime iso={job.created_at} />
        </div>
      </div>

      {logsOpen && (
        <div className="ml-8 mb-3 rounded-md bg-muted/50 border border-border text-xs font-mono overflow-auto max-h-48">
          {logsLoading ? (
            <div className="p-3 text-muted-foreground">Loading…</div>
          ) : logs.length === 0 ? (
            <div className="p-3 text-muted-foreground">No log entries.</div>
          ) : (
            <div className="divide-y divide-border">
              {logs.map((l, i) => (
                <div
                  key={`${l.timestamp}-${i}`}
                  className={`px-3 py-1.5 ${l.level === "warning" ? "text-amber-400" : l.level === "error" ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {l.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Jobs() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const focusId = Number(searchParams.get("focus")) || null;
  const [clearing, setClearing] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<number>>(new Set());

  const {
    data: jobs = [],
    isLoading: loading,
    error: jobsError,
    refetch: refetchJobs,
  } = useQuery<Job[]>({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(),
  });

  const loadAll = () => queryClient.invalidateQueries({ queryKey: qk.jobs() });

  const handleCancel = async (id: number) => {
    setCancellingIds((s) => new Set(s).add(id));
    try {
      await api.cancelJob(id);
    } catch (e) {
      toast.error(`Couldn't cancel the job: ${getErrorMessage(e)}`);
    } finally {
      setCancellingIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const handleClearHistory = async () => {
    setClearing(true);
    try {
      await api.clearJobHistory();
      await loadAll();
    } finally {
      setClearing(false);
    }
  };

  const running = jobs.filter((j) => j.status === "running" || j.status === "pending");
  const history = jobs.filter((j) => j.status !== "running" && j.status !== "pending");

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor scan and transcode jobs.</p>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearHistory}
              disabled={clearing}
              className="text-muted-foreground hover:text-destructive text-xs"
            >
              {clearing && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Clear history
            </Button>
          )}
          <IconButton
            label="Refresh"
            onClick={loadAll}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {loading ? (
        <ListSkeleton rows={5} />
      ) : jobsError ? (
        <QueryError error={jobsError} onRetry={() => void refetchJobs()} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No jobs yet"
          description="Trigger a scan from the Libraries page."
        />
      ) : (
        <div className="space-y-6">
          {running.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-0">
                <SectionHeader className="mb-2">Active</SectionHeader>
                {running.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    focused={j.id === focusId}
                    onCancel={cancellingIds.has(j.id) ? undefined : handleCancel}
                  />
                ))}
              </CardContent>
            </Card>
          )}
          {history.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-0">
                <SectionHeader className="mb-2">History</SectionHeader>
                {history.map((j) => (
                  <JobRow key={j.id} job={j} focused={j.id === focusId} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
