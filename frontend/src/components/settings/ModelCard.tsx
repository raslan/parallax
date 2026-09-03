import { useEffect, useState } from "react";
import { AlertCircle, Download, Loader2, Trash2 } from "lucide-react";
import { modelsApi } from "@/lib/api";
import type { ActiveModelDownload, ModelInfo } from "@/types/model";
import { toast } from "sonner"; // sonner toast fn works independently of Toaster wrapper
import { Button } from "@/components/ui/button";
import { formatSize } from "@/lib/format";
import { useJobPoll } from "@/hooks/useJobPoll";

export function ModelCard({
  model,
  onAction,
  activeDownload,
}: {
  model: ModelInfo;
  onAction: () => void;
  activeDownload?: ActiveModelDownload | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    jobId,
    progress: jobProgress,
    currentFile,
    status: pollStatus,
    start: startPoll,
  } = useJobPoll({
    onTerminal: (job) => {
      setBusy(false);
      if (job.status === "completed") onAction();
      else if (job.status === "failed") setError(job.error ?? "Download failed");
    },
  });
  const jobStatus = currentFile ?? pollStatus ?? "";

  // Reconnect to an in-progress download after navigation
  useEffect(() => {
    if (
      activeDownload &&
      activeDownload.model_type === model.type &&
      activeDownload.model_id === model.id &&
      !model.downloaded
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBusy(true);
      startPoll(activeDownload.job_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await (model.type === "whisper"
        ? modelsApi.downloadWhisper(model.id)
        : modelsApi.downloadNudenet(model.id));
      startPoll(res.job_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await (model.type === "whisper"
        ? modelsApi.deleteWhisper(model.id)
        : modelsApi.deleteNudenet(model.id));
      onAction();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      await (model.type === "whisper"
        ? modelsApi.activateWhisper(model.id)
        : modelsApi.activateNudenet(model.id));
      onAction();
      if (model.type === "nudenet") {
        toast("Model changed — rescan recommended to update keyframe resolution", {
          duration: 4000,
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const downloading = busy && jobId != null;

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${model.active ? "border-primary bg-primary/5" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{model.name}</span>
            {model.active && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                Active
              </span>
            )}
            {model.bundled && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                Bundled
              </span>
            )}
            {!model.bundled && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {formatSize(model.size_mb * 1024 * 1024)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{model.description}</p>
          {downloading && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                  {jobStatus}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
                  {Math.round(jobProgress)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${jobProgress}%` }}
                />
              </div>
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!model.downloaded && !model.bundled && !downloading && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={download}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Download
            </Button>
          )}
          {downloading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {model.downloaded && !model.active && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={activate}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Use"}
              </Button>
              {!model.bundled && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={remove}
                  disabled={busy}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
          {model.active && !model.bundled && (
            <span className="text-[10px] text-muted-foreground">In use</span>
          )}
        </div>
      </div>
    </div>
  );
}
