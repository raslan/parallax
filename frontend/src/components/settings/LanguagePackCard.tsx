import { useEffect, useRef, useState } from "react";
import { AlertCircle, Download, Loader2, Trash2 } from "lucide-react";
import { subtitlePacksApi } from "@/lib/api";
import type { SubtitlePack } from "@/types/subtitlePack";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ProgressBar";
import { formatSize } from "@/lib/format";
import { useJobPoll } from "@/hooks/useJobPoll";
import { errorDetail } from "@/lib/api/client";

/** One row of Settings → Subtitles → Language packs: size, status, Install / Remove, credit. */
export function LanguagePackCard({ pack, onChange }: { pack: SubtitlePack; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useJobPoll({
    onTerminal: (job) => {
      setBusy(false);
      if (job.status === "failed") setError(job.error ?? "Install failed");
      onChange();
    },
  });

  // Pick an install that is already running back up after a reload or navigation.
  const resumedFor = useRef<number | null>(null);
  useEffect(() => {
    if (pack.installing_job_id != null && resumedFor.current !== pack.installing_job_id) {
      resumedFor.current = pack.installing_job_id;
      setBusy(true);
      poll.start(pack.installing_job_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.installing_job_id]);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await subtitlePacksApi.install(pack.lang);
      poll.start(res.job_id);
    } catch (e) {
      setError(errorDetail(e, "Could not start the install"));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await subtitlePacksApi.remove(pack.lang);
      onChange();
    } catch (e) {
      setError(errorDetail(e, "Could not remove the pack"));
    } finally {
      setBusy(false);
    }
  };

  const installing = busy && poll.jobId != null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{pack.name}</span>
            <span className="text-3xs text-muted-foreground font-mono">
              {formatSize(pack.installed ? pack.installed_bytes : pack.size_bytes)}
            </span>
            {pack.installed && (
              <span className="text-3xs font-semibold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                Installed
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Translates English subtitles into {pack.name}, on this computer. {pack.model}. From{" "}
            <a
              href={pack.upstream_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              {pack.upstream_url.replace("https://huggingface.co/", "")}
            </a>
            , licence{" "}
            <a
              href={pack.licence_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              {pack.licence}
            </a>
            .
          </p>
          {installing && (
            <div className="mt-2 space-y-1">
              <div className="flex justify-end text-2xs text-muted-foreground">
                {Math.round(poll.progress)}%
              </div>
              <ProgressBar value={poll.progress} label={`${pack.name} pack download progress`} />
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
          {!pack.installed && !installing && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={install}
              disabled={busy}
            >
              <Download className="h-3 w-3" />
              Install
            </Button>
          )}
          {installing && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {pack.installed && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={remove}
              disabled={busy}
              aria-label={`Remove the ${pack.name} language pack`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
