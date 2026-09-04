import { useState } from "react";
import { ExternalLink, ImageOff, Play, RotateCcw, StopCircle, Trash2, X } from "lucide-react";
import type { DownloadItem } from "@/types/download";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

export function DownloadCard({
  item,
  onPlay,
  onClear,
  onDeleteFile,
  onRetry,
}: {
  item: DownloadItem;
  onPlay: (item: DownloadItem) => void;
  onClear: (id: number) => void;
  onDeleteFile: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isActive = item.status === "pending" || item.status === "running";
  const isCompleted = item.status === "completed";
  const canPlay = isCompleted && !!item.output_path;

  const handleDeleteFile = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      onDeleteFile(item.id);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors group">
      {/* Thumbnail */}
      <div className="w-24 h-[54px] shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center relative">
        {item.thumbnail_url && !imgError ? (
          <img
            src={`/api/downloads/${item.id}/thumbnail`}
            alt=""
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground/30" />
        )}
        {canPlay && (
          <button
            onClick={() => onPlay(item)}
            className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Play className="h-5 w-5 text-white" />
          </button>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1 min-h-0">
        <p className="text-sm font-medium truncate leading-tight" title={item.title ?? item.url}>
          {item.title ?? (
            <span className="font-mono text-muted-foreground text-xs break-all line-clamp-1">
              {item.url}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {item.uploader && (
            <span className="text-xs text-muted-foreground/60 truncate">{item.uploader}</span>
          )}
          {item.duration != null && (
            <span className="text-xs text-muted-foreground/40 shrink-0">
              {formatDuration(item.duration)}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {isActive && (
          <div className="space-y-0.5">
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-all duration-500",
                  item.status === "running" &&
                    item.progress === 0 &&
                    "animate-pulse w-full opacity-40",
                )}
                style={item.progress > 0 ? { width: `${item.progress}%` } : undefined}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                {item.progress > 0
                  ? `${Math.round(item.progress)}%`
                  : item.status === "running"
                    ? "Processing…"
                    : "Waiting…"}
              </span>
              {(item.speed || item.eta) && (
                <span className="text-[10px] text-muted-foreground/50 font-mono">
                  {item.speed}
                  {item.speed && item.eta ? " · " : ""}
                  {item.eta ? `ETA ${item.eta}` : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {item.error && (
          <button onClick={() => setErrorExpanded((v) => !v)} className="text-left w-full">
            {errorExpanded ? (
              <pre className="text-[11px] text-red-400 whitespace-pre-wrap break-all font-mono leading-relaxed">
                {item.error}
              </pre>
            ) : (
              <p className="text-[11px] text-red-400 line-clamp-2">{item.error.split("\n")[0]}</p>
            )}
          </button>
        )}

        {/* Output path */}
        {isCompleted && item.output_path && (
          <p
            className="text-[10px] text-muted-foreground/40 font-mono truncate"
            title={item.output_path}
          >
            {item.output_path}
          </p>
        )}
      </div>

      {/* Badge — vertically centred as its own column */}
      <StatusBadge status={item.status} />

      {/* Actions */}
      {confirmDelete ? (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground/70">Delete file?</span>
          <button
            onClick={() => {
              setConfirmDelete(false);
              onDeleteFile(item.id);
            }}
            className="px-2 py-0.5 text-xs rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30 transition-colors"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-2 py-0.5 text-xs rounded hover:bg-muted/60 text-muted-foreground border border-border/50 transition-colors"
          >
            No
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open source URL"
            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {canPlay && (
            <button
              onClick={() => onPlay(item)}
              title="Play"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {isActive && (
            <button
              onClick={() => onClear(item.id)}
              title="Stop download"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-red-400 transition-colors"
            >
              <StopCircle className="h-3.5 w-3.5" />
            </button>
          )}
          {!isActive && (
            <button
              onClick={() => onClear(item.id)}
              title="Remove from list"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {(item.status === "failed" || item.status === "cancelled") && (
            <button
              onClick={() => onRetry(item.id)}
              title="Retry download"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-primary transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          {isCompleted && (
            <button
              onClick={handleDeleteFile}
              title="Delete file from disk (Shift+click to skip confirm)"
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
