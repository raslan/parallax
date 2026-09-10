import { Check, Play, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { VideoFile } from "@/types/file";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { VideoThumbnail } from "@/components/VideoThumbnail";
import { cn } from "@/lib/utils";
import { formatSize, formatDuration } from "@/lib/format";

export type SortDir = "asc" | "desc";

export function applySortDir<T>(arr: T[], dir: SortDir): T[] {
  return dir === "desc" ? [...arr].reverse() : arr;
}

export function filterByFilename<T extends { filename: string }>(files: T[], search: string): T[] {
  const q = search.trim().toLowerCase();
  return q ? files.filter((f) => f.filename.toLowerCase().includes(q)) : files;
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
  return (
    <Card
      className={cn(
        "overflow-hidden cursor-pointer group transition-shadow hover:ring-1",
        selected ? "ring-2 ring-primary" : "hover:ring-primary",
      )}
      onClick={onToggle}
    >
      <div className="aspect-[4/3] bg-muted relative flex items-center justify-center">
        <VideoThumbnail
          fileId={file.id}
          scannedAt={file.scanned_at}
          alt={file.filename}
          imgClassName="w-full h-full object-cover"
        />

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

      <div
        className="px-2 py-1.5 space-y-0.5 border-t border-border"
        style={{ background: "var(--px-bg-elevated)" }}
      >
        <p className="text-xs font-mono truncate text-foreground/90" title={file.filename}>
          {file.filename}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
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
  thumbnail,
  selectable = true,
  clickAction = "select",
  columns,
  className,
}: {
  file: {
    id: number;
    path?: string;
    filename: string;
    codec_name?: string | null;
    duration?: number | null;
    size: number;
  };
  selected: boolean;
  onToggle: () => void;
  onPlay: () => void;
  trailing?: React.ReactNode;
  /** A `<VideoThumbnail>` node rendered inside the play button; falls back to a `bg-muted` well (audio pages). */
  thumbnail?: React.ReactNode;
  /** When false, no checkbox is rendered (e.g. AudioFiles has no selection). */
  selectable?: boolean;
  /** What a click on the row body does. Defaults to toggling selection. */
  clickAction?: "select" | "play";
  /** Replaces the default codec/duration/size columns when provided. */
  columns?: React.ReactNode;
  /** Merged onto the row root — escape hatch for e.g. a bordered card row. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer select-none",
        selected && "bg-primary/5",
        className,
      )}
      onClick={clickAction === "play" ? onPlay : onToggle}
    >
      {selectable && (
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
        />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        title="Play"
        className="relative group/thumb h-8 w-14 shrink-0"
      >
        {thumbnail ? (
          <>
            {thumbnail}
            {/* hover overlay — the thumbnail already reads as content, so the
                play glyph only appears on hover */}
            <div className="absolute inset-0 flex items-center justify-center rounded bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
              <Play className="h-3.5 w-3.5 text-white fill-white" />
            </div>
          </>
        ) : (
          // no real thumbnail (audio) — keep the play glyph always visible
          <div className="h-8 w-14 rounded bg-muted flex items-center justify-center text-muted-foreground group-hover/thumb:text-foreground transition-colors">
            <Play className="h-3.5 w-3.5 fill-current" />
          </div>
        )}
      </button>
      <span
        className="flex-1 text-sm font-mono truncate text-muted-foreground min-w-0"
        title={file.path}
      >
        {file.filename}
      </span>
      {columns ?? (
        <>
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
        </>
      )}
      {trailing}
    </div>
  );
}
