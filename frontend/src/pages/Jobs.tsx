import { useEffect, useState } from "react";
import { Activity, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Square } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, Job } from "@/lib/api";
import { formatDate } from "@/lib/format";

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-blue-400" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-400" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
};

function JobRow({ job, onCancel }: { job: Job; onCancel?: (id: number) => void }) {
  const canCancel = (job.status === "running" || job.status === "pending") && onCancel;

  return (
    <div className="flex items-center gap-4 py-3 border-b last:border-0">
      <div className="shrink-0">{STATUS_ICON[job.status] ?? <Clock className="h-4 w-4" />}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize">{job.type}</span>
          <Badge variant="secondary" className="text-xs capitalize">{job.status}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {job.status === "running"
            ? `${job.processed_files} / ${job.total_files} files · ${Math.round(job.progress)}%`
            : `${job.processed_files} / ${job.total_files} files`}
        </p>
        {job.error && (
          <p className="text-xs text-destructive truncate" title={job.error}>{job.error}</p>
        )}
      </div>

      {job.status === "running" && (
        <div className="w-24 shrink-0">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      )}

      {canCancel && (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          title="Stop this job"
          onClick={() => onCancel(job.id)}
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
      )}

      <div className="text-xs text-muted-foreground shrink-0 text-right min-w-[100px]">
        {formatDate(job.created_at)}
      </div>
    </div>
  );
}

export function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingIds, setCancellingIds] = useState<Set<number>>(new Set());
  const [clearing, setClearing] = useState(false);

  const load = () => {
    api.getJobs().then(setJobs).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const handleClearHistory = async () => {
    setClearing(true);
    try {
      await api.clearJobHistory();
      await load();
    } finally {
      setClearing(false);
    }
  };

  const handleCancel = async (id: number) => {
    setCancellingIds((s) => new Set(s).add(id));
    try {
      await api.cancelJob(id);
    } catch {
      // ignore — job may have finished between click and request
    } finally {
      setCancellingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const running = jobs.filter((j) => j.status === "running" || j.status === "pending");
  const history = jobs.filter((j) => j.status !== "running" && j.status !== "pending");

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor scan and transcode jobs.
          </p>
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
              {clearing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Clear history
            </Button>
          )}
          <button
            onClick={load}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : jobs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Activity className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No jobs yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Scan and transcode jobs will appear here. Trigger a scan from the Libraries page.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {running.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Active</p>
                {running.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    onCancel={cancellingIds.has(j.id) ? undefined : handleCancel}
                  />
                ))}
              </CardContent>
            </Card>
          )}
          {history.length > 0 && (
            <Card>
              <CardContent className="pt-4 pb-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">History</p>
                {history.map((j) => <JobRow key={j.id} job={j} />)}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
