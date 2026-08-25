import { useState } from "react";
import {
  ImageOff,
  Check,
  Play,
  CheckSquare,
  Square,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { VideoFile, api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatSize, formatDuration } from "@/lib/format";

export type SortDir = "asc" | "desc";

export function applySortDir<T>(arr: T[], dir: SortDir): T[] {
  return dir === "desc" ? [...arr].reverse() : arr;
}

export function FileGridCard({
  file,
  selected,
  onToggle,
  onPlay,
  badge,
}: {
  file: VideoFile;
  selected: boolean;
  onToggle: () => void;
  onPlay: () => void;
  badge?: React.ReactNode;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <Card
      className={cn(
        "overflow-hidden cursor-pointer group transition-shadow hover:ring-1",
        selected ? "ring-2 ring-primary" : "hover:ring-primary",
      )}
      onClick={onToggle}
    >
      <div className="aspect-video bg-muted relative flex items-center justify-center">
        {file.has_thumbnail && !imgError ? (
          <img
            src={api.thumbnailUrl(file.id, file.scanned_at ?? undefined)}
            alt={file.filename}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <ImageOff className="h-8 w-8 text-muted-foreground/40" />
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            "absolute top-1.5 left-1.5 z-10 h-4 w-4 rounded border-2 flex items-center justify-center transition-colors",
            selected ? "bg-primary border-primary" : "bg-black/50 border-white/70",
          )}
        >
          {selected && <Check className="h-2.5 w-2.5 text-white" />}
        </button>

        {badge && <div className="absolute top-1.5 right-1.5">{badge}</div>}

        <div className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            title="Preview"
            className="bg-black/60 hover:bg-black/80 rounded p-1"
          >
            <Play className="h-3.5 w-3.5 text-white" />
          </button>
        </div>
      </div>

      <div className="px-2 py-1.5 space-y-0.5">
        <p className="text-xs font-mono truncate text-muted-foreground" title={file.filename}>
          {file.filename}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
          {file.codec_name && <span className="uppercase font-mono">{file.codec_name}</span>}
          <span>{formatSize(file.size)}</span>
          {file.duration != null && <span>{formatDuration(file.duration)}</span>}
        </div>
      </div>
    </Card>
  );
}

export function ColHeader<K extends string>({
  label,
  sortKey,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  current: K;
  dir: SortDir;
  onSort: (k: K) => void;
  className?: string;
}) {
  const active = current === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={cn(
        "flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/40 hover:text-muted-foreground transition-colors",
        className,
      )}
    >
      {label}
      {active ? (
        dir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  );
}

export function FileListRow({
  file,
  selected,
  onToggle,
  onPlay,
  trailing,
}: {
  file: VideoFile;
  selected: boolean;
  onToggle: () => void;
  onPlay: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer select-none group",
        selected && "bg-primary/5",
      )}
      onClick={onToggle}
    >
      <span className="shrink-0">
        {selected ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4 text-muted-foreground" />
        )}
      </span>
      <span
        className="flex-1 text-sm font-mono truncate text-muted-foreground min-w-0"
        title={file.path}
      >
        {file.filename}
      </span>
      {file.codec_name && (
        <span className="text-xs text-muted-foreground/60 font-mono shrink-0 w-14 text-right uppercase">
          {file.codec_name}
        </span>
      )}
      <span className="text-xs text-muted-foreground/50 shrink-0 w-14 text-right">
        {file.duration != null ? formatDuration(file.duration) : "—"}
      </span>
      <span className="text-xs text-muted-foreground/70 shrink-0 w-16 text-right font-mono">
        {formatSize(file.size)}
      </span>
      {trailing}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        title="Preview"
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-foreground text-muted-foreground/50"
      >
        <Play className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
