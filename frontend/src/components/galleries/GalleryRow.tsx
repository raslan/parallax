import { useState } from "react";
import { ChevronRight, ExternalLink, RotateCcw, StopCircle, X } from "lucide-react";
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
  const [showRecent, setShowRecent] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const isActive = row.status === "pending" || row.status === "running";
  const isRunning = row.status === "running";
  const canRetry = row.status === "failed" || row.status === "cancelled";
  const isFileMode = row.url.startsWith("file:");

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors group">
      <DownloadStatusBadge status={row.status} />

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" title={row.url}>
            {isFileMode ? "urls.txt (file mode)" : row.url}
          </span>
          {!isFileMode && /^https?:\/\//i.test(row.url) && (
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

        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span key={`d-${row.files_done}`} className="text-emerald-400 animate-pop">
            ✓ {row.files_done}
          </span>
          <span key={`s-${row.files_skipped}`} className="text-muted-foreground/60 animate-pop">
            ⤼ {row.files_skipped} skipped
          </span>
          {row.files_failed > 0 && (
            <span key={`f-${row.files_failed}`} className="text-red-400 animate-pop">
              ✗ {row.files_failed} failed
            </span>
          )}
        </div>

        {isRunning && row.files_done === 0 && (
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full w-full bg-primary/40 animate-shimmer" />
          </div>
        )}

        {row.last_filename && (
          <p className="text-[10px] text-muted-foreground/40 font-mono truncate">
            last: {row.last_filename}
          </p>
        )}

        {row.recent_files.length > 0 && (
          <button
            onClick={() => setShowRecent((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
          >
            <ChevronRight
              className={cn("h-3 w-3 transition-transform", showRecent && "rotate-90")}
            />
            recent
          </button>
        )}
        {showRecent && (
          <ul className="pl-4 space-y-0.5">
            {row.recent_files.map((f, i) => (
              <li key={i} className="text-[10px] text-muted-foreground/50 font-mono truncate">
                {f}
              </li>
            ))}
          </ul>
        )}

        {row.error && (
          <button onClick={() => setErrorExpanded((v) => !v)} className="text-left w-full">
            {errorExpanded ? (
              <pre className="text-[11px] text-red-400 whitespace-pre-wrap break-all font-mono leading-relaxed">
                {row.error}
              </pre>
            ) : (
              <p className="text-[11px] text-red-400 line-clamp-2">{row.error.split("\n")[0]}</p>
            )}
          </button>
        )}
      </div>

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
    </div>
  );
}
