import { useState } from "react";
import {
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  RotateCcw,
  SkipForward,
  StopCircle,
  Terminal,
  X,
} from "lucide-react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { GalleryDownload } from "@/types/gallery";
import { DownloadStatusBadge } from "@/components/downloads-common/DownloadStatusBadge";
import { cn } from "@/lib/utils";

export function GalleryRow({
  row,
  onStop,
  onRemove,
  onRetry,
}: {
  row: GalleryDownload;
  onStop: (id: number) => void;
  onRemove: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [logExpanded, setLogExpanded] = useState(
    () => Boolean(row.log_tail) && row.files_failed > 0 && row.files_done === 0,
  );
  const [streamRef] = useAutoAnimate<HTMLDivElement>();

  const isActive = row.status === "pending" || row.status === "running";
  const isRunning = row.status === "running";
  const canRetry = row.status === "failed" || row.status === "cancelled";
  const isFileMode = row.url.startsWith("file:");
  const isHttp = !isFileMode && /^https?:\/\//i.test(row.url);
  const urlLabel = isFileMode ? "urls.txt (file mode)" : row.url;

  const urlLine = (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={cn("truncate", isActive ? "text-sm font-medium" : "text-sm")}
        title={row.url}
      >
        {urlLabel}
      </span>
      {isHttp && (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );

  const errorBlock = row.error ? (
    <button onClick={() => setErrorExpanded((v) => !v)} className="text-left w-full">
      {errorExpanded ? (
        <pre className="text-[11px] text-destructive whitespace-pre-wrap break-all font-mono leading-relaxed">
          {row.error}
        </pre>
      ) : (
        <p className="text-[11px] text-destructive line-clamp-2">{row.error.split("\n")[0]}</p>
      )}
    </button>
  ) : null;

  const logBlock = row.log_tail ? (
    <div>
      <button
        onClick={() => setLogExpanded((v) => !v)}
        className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground inline-flex items-center gap-1 transition-colors"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", logExpanded && "rotate-90")} />
        <Terminal className="h-3 w-3" />
        output
      </button>
      {logExpanded && row.log_tail && (
        <pre className="mt-1 max-h-48 overflow-y-auto rounded bg-muted/40 p-2 text-[11px] font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
          {row.log_tail}
        </pre>
      )}
    </div>
  ) : null;

  const actions = (
    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
      {isActive && (
        <button
          onClick={() => onStop(row.id)}
          title="Stop"
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-red-400 transition-colors"
        >
          <StopCircle className="h-3.5 w-3.5" />
        </button>
      )}
      {canRetry && (
        <button
          onClick={() => onRetry(row.id)}
          title="Retry"
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-primary transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      {!isActive && (
        <button
          onClick={() => onRemove(row.id)}
          title="Remove from list"
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  // ---- Terminal row: compact history ---------------------------------------
  if (!isActive) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 border-l-2 border-transparent border-b border-border/40 last:border-b-0 hover:bg-muted/20 transition-colors group">
        <DownloadStatusBadge status={row.status} />

        <div className="flex-1 min-w-0 space-y-1">
          {urlLine}

          <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Check className="h-3 w-3 shrink-0" />
              {row.files_done}
            </span>
            <span className="inline-flex items-center gap-1">
              <SkipForward className="h-3 w-3 shrink-0" />
              {row.files_skipped} skipped
            </span>
            {row.files_failed > 0 && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <X className="h-3 w-3 shrink-0" />
                {row.files_failed} failed
              </span>
            )}
          </div>

          {row.last_filename && (
            <p className="text-[10px] text-muted-foreground/40 font-mono truncate">
              last: {row.last_filename}
            </p>
          )}

          {errorBlock}

          {logBlock}
        </div>

        {actions}
      </div>
    );
  }

  // ---- Active row: room + live motion ------------------------------------
  const recent = row.recent_files.slice(-3);

  return (
    <div className="border-l-2 border-primary/50 border-b border-border/40 last:border-b-0 px-4 py-4 hover:bg-muted/20 transition-colors group">
      <div className="flex items-start gap-4">
        {/* Left: badge + url + filename stream */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <DownloadStatusBadge status={row.status} />
            {isRunning && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-ring shrink-0" />
            )}
          </div>

          {urlLine}

          <div ref={streamRef} className="space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground min-w-0">
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{row.last_filename ?? "waiting for first file…"}</span>
            </p>
            {recent.map((f, i) => (
              <p
                key={`${f}-${i}`}
                className="pl-5 text-[11px] font-mono text-muted-foreground/40 truncate"
              >
                {f}
              </p>
            ))}
          </div>
        </div>

        {/* Right: 3-up stat strip + hover actions */}
        <div className="flex items-start gap-4 shrink-0">
          <div className="flex flex-col items-center">
            <span
              key={row.files_done}
              className="inline-flex items-center gap-1 text-2xl font-bold font-mono tabular-nums tracking-tight text-emerald-400 animate-pop"
            >
              <Check className="h-4 w-4 shrink-0" />
              {row.files_done}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
              done
            </span>
          </div>

          <div className="flex flex-col items-center">
            <span
              key={row.files_skipped}
              className="inline-flex items-center gap-1 text-lg font-bold font-mono tabular-nums tracking-tight text-muted-foreground animate-pop"
            >
              <SkipForward className="h-3.5 w-3.5 shrink-0" />
              {row.files_skipped}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
              skipped
            </span>
          </div>

          {row.files_failed > 0 && (
            <div className="flex flex-col items-center">
              <span
                key={row.files_failed}
                className="inline-flex items-center gap-1 text-lg font-bold font-mono tabular-nums tracking-tight text-destructive animate-pop"
              >
                <X className="h-3.5 w-3.5 shrink-0" />
                {row.files_failed}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
                failed
              </span>
            </div>
          )}

          {actions}
        </div>
      </div>

      {/* Full-width "it's alive" rail — the entire time the process runs */}
      {isRunning && (
        <div className="mt-3 h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-full bg-primary/40 animate-shimmer" />
        </div>
      )}

      {errorBlock && <div className="mt-2">{errorBlock}</div>}

      {logBlock && <div className="mt-2">{logBlock}</div>}
    </div>
  );
}
