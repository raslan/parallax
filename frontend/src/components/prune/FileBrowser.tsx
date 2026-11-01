import { useState } from "react";
import { Check, FileIcon, Film, FolderOpen, ImageIcon, Music, Play } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { GridSizeControl } from "@/components/GridSizeControl";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/Tip";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { ViewToggle, type ViewMode } from "@/components/DataToolbar";
import { GridSkeleton, ListSkeleton } from "@/components/Skeletons";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { DetailsProgress } from "@/components/prune/DetailsProgress";
import { useGridSize } from "@/hooks/useGridSize";
import { formatBitrate, formatDuration, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FileDetails, PruneFile } from "@/types/prune";

const KIND_ICON: Record<PruneFile["kind"], LucideIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  other: FileIcon,
};

/** Chrome plays these natively; the backend 400s `/prune/audio` for them. */
const NATIVE_AUDIO = new Set([".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".flac"]);

const CARD_CHROME = 64; // footer height under the 4:3 thumbnail
const ROW_HEIGHT = 52;

type DetailsMap = Record<string, FileDetails | null>;

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/** Stand-in for the modals' library-row shape; only these fields are read. */
function asPlayable(file: PruneFile, d: FileDetails | null | undefined) {
  return {
    id: 0,
    filename: file.name,
    path: file.path,
    size: file.size,
    duration: d?.duration ?? null,
    codec_name: d?.codec ?? null,
    video_bitrate: d?.bitrate ?? null,
  };
}

/** Thumbnail that fades in once loaded; the kind icon shows until then and when there is none. */
function Thumb({ file, className }: { file: PruneFile; className?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const Icon = KIND_ICON[file.kind];
  // Audio and "other" never have thumbnails, so don't ask (and don't 404).
  const hasThumb = file.kind === "image" || file.kind === "video";
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon
        className={cn(
          "h-1/3 max-h-10 w-1/3 max-w-10 min-h-4 min-w-4 transition-opacity duration-200",
          state === "ok" ? "opacity-0" : "opacity-60",
        )}
      />
      {hasThumb && state !== "error" && (
        <img
          loading="lazy"
          src={api.pruneThumbnailUrl(file.path)}
          alt=""
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
            state === "ok" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}

/** "12:04 · 1920×1080 · h264" with a shimmer while details are still loading. */
function Meta({ d, loading }: { d: FileDetails | null | undefined; loading: boolean }) {
  if (d === undefined) {
    return loading ? <Skeleton className="h-3 w-24" /> : null;
  }
  if (d === null) return null;
  const parts = [
    d.duration ? formatDuration(d.duration) : null,
    d.width && d.height ? `${d.width}×${d.height}` : null,
    d.codec,
    d.bitrate ? formatBitrate(d.bitrate) : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span className="block animate-fade-in truncate font-mono text-2xs tabular-nums text-muted-foreground">
      {parts.join(" · ")}
    </span>
  );
}

function SelectMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-md border bg-px-elevated transition-all duration-100",
        selected ? "border-primary bg-primary text-px-on-accent" : "text-transparent",
      )}
    >
      <Check className="h-3 w-3" />
    </span>
  );
}

function FileCard({
  file,
  d,
  detailsLoading,
  index,
  selected,
  leaving,
  onOpen,
  onToggleSelect,
}: {
  file: PruneFile;
  d: FileDetails | null | undefined;
  detailsLoading: boolean;
  index: number;
  selected: boolean;
  leaving: boolean;
  onOpen: (f: PruneFile) => void;
  onToggleSelect?: (f: PruneFile, e: React.MouseEvent) => void;
}) {
  const playable = file.kind !== "other";
  const thumb = <Thumb file={file} className="aspect-4/3 w-full" />;
  return (
    <div
      className={cn(
        "group relative flex h-full animate-slide-up-fade flex-col overflow-hidden rounded-lg border bg-px-elevated transition-all duration-150 ease-out [animation-fill-mode:backwards]",
        leaving && "pointer-events-none scale-95 opacity-0 duration-200 motion-reduce:scale-100",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg",
      )}
      style={{ animationDelay: `${Math.min(index, 14) * 28}ms` }}
    >
      {playable ? (
        <button
          type="button"
          onClick={() => onOpen(file)}
          aria-label={`${file.kind === "image" ? "View" : "Play"} ${file.name}`}
          className="relative block w-full focus-visible:outline-hidden"
        >
          {thumb}
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-0">
            <Play className="h-7 w-7 fill-white text-white" />
          </span>
        </button>
      ) : (
        thumb
      )}
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-0.5 border-t px-2.5 py-1.5">
        <Tip label={file.name}>
          <span className="truncate text-sm font-medium">{file.name}</span>
        </Tip>
        <span className="font-mono text-2xs tabular-nums text-muted-foreground">
          {formatSize(file.size)}
        </span>
        <Meta d={d} loading={detailsLoading} />
      </div>
      {onToggleSelect && (
        <button
          type="button"
          aria-label={`${selected ? "Deselect" : "Select"} ${file.name}`}
          aria-pressed={selected}
          onClick={(e) => onToggleSelect(file, e)}
          className={cn(
            "absolute left-2 top-2 z-10 transition-opacity duration-100 focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100",
            selected ? "opacity-100" : "opacity-0",
          )}
        >
          <SelectMark selected={selected} />
        </button>
      )}
    </div>
  );
}

function FileRow({
  file,
  d,
  detailsLoading,
  index,
  selected,
  leaving,
  onOpen,
  onToggleSelect,
}: {
  file: PruneFile;
  d: FileDetails | null | undefined;
  detailsLoading: boolean;
  index: number;
  selected: boolean;
  leaving: boolean;
  onOpen: (f: PruneFile) => void;
  onToggleSelect?: (f: PruneFile, e: React.MouseEvent) => void;
}) {
  const playable = file.kind !== "other";
  return (
    <div
      className={cn(
        "group relative flex h-full animate-slide-up-fade items-center gap-3 border-b px-3 transition-all duration-100 [animation-fill-mode:backwards] last:border-b-0",
        leaving &&
          "pointer-events-none -translate-x-2 opacity-0 duration-200 motion-reduce:translate-x-0",
        selected ? "bg-accent/60" : "hover:bg-accent/40",
      )}
      style={{ animationDelay: `${Math.min(index, 14) * 28}ms` }}
    >
      {onToggleSelect && (
        <button
          type="button"
          aria-label={`${selected ? "Deselect" : "Select"} ${file.name}`}
          aria-pressed={selected}
          onClick={(e) => onToggleSelect(file, e)}
        >
          <SelectMark selected={selected} />
        </button>
      )}
      <button
        type="button"
        disabled={!playable}
        onClick={() => onOpen(file)}
        aria-label={`${file.kind === "image" ? "View" : "Play"} ${file.name}`}
        className="relative h-8 w-14 shrink-0 overflow-hidden rounded-md focus-visible:outline-hidden disabled:cursor-default"
      >
        <Thumb file={file} className="h-full w-full" />
        {playable && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100 touch:opacity-0">
            <Play className="h-3.5 w-3.5 fill-white text-white" />
          </span>
        )}
      </button>
      <span className="min-w-0 flex-1">
        <Tip label={file.name}>
          <span className="block truncate text-sm font-medium">{file.name}</span>
        </Tip>
        <Meta d={d} loading={detailsLoading} />
      </span>
      <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatSize(file.size)}
      </span>
    </div>
  );
}

/**
 * The open folder's direct files as a thumbnail grid or list, with click-to-preview
 * (video/audio in the player modal, images in the lightbox). Props-in/callbacks-out:
 * `files` arrives already filtered (undefined = loading) and `details` streams in
 * from `usePruneDetails`. Selection is optional (`selected` + `onToggleSelect`);
 * `leaving` paths play the delete exit animation before the list refetches.
 * `filtered` swaps the empty-state copy when a filter hides everything.
 */
export function FileBrowser({
  files,
  details,
  progress,
  selected,
  leaving,
  onToggleSelect,
  filtered,
}: {
  files: PruneFile[] | undefined;
  details: DetailsMap;
  progress: { loaded: number; total: number; done: boolean };
  selected?: ReadonlySet<string>;
  leaving?: ReadonlySet<string>;
  onToggleSelect?: (file: PruneFile, e: React.MouseEvent) => void;
  /** True when a filter is active, so an empty list reads as "nothing matches". */
  filtered?: boolean;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [gridSize, setGridSize] = useGridSize(240);
  const [preview, setPreview] = useState<PruneFile | null>(null);

  const detailsLoading = !progress.done;
  const none: ReadonlySet<string> = new Set();
  const sel = selected ?? none;

  const renderItem = (layout: "grid" | "list") => (f: PruneFile) => {
    const props = {
      file: f,
      d: details[f.path],
      detailsLoading,
      index: files?.indexOf(f) ?? 0,
      selected: sel.has(f.path),
      leaving: leaving?.has(f.path) ?? false,
      onOpen: setPreview,
      onToggleSelect,
    };
    return layout === "grid" ? <FileCard {...props} /> : <FileRow {...props} />;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Files{files ? ` · ${files.length.toLocaleString()}` : ""}
          </h2>
          <DetailsProgress {...progress} />
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle value={viewMode} onChange={setViewMode} />
          {viewMode === "grid" && <GridSizeControl value={gridSize} onChange={setGridSize} />}
        </div>
      </div>

      {!files ? (
        viewMode === "grid" ? (
          <GridSkeleton count={8} minColumnWidth={gridSize} />
        ) : (
          <ListSkeleton rows={6} />
        )
      ) : files.length === 0 ? (
        <EmptyState
          size="sm"
          icon={FolderOpen}
          title={filtered ? "No files match" : "No files here"}
          description={
            filtered
              ? "Nothing in this folder matches the current filters. Adjust or remove a filter to see files again."
              : "Files in this folder were moved or deleted since the last scan. Rescan to refresh."
          }
        />
      ) : viewMode === "grid" ? (
        <VirtualizedGrid
          items={files}
          getKey={(f) => f.path}
          mode="grid"
          itemHeight={CARD_CHROME + gridSize * 0.75}
          itemAspectRatio={4 / 3}
          itemChromeHeight={CARD_CHROME}
          minColumnWidth={gridSize}
          maxHeight="70vh"
          resetKey={`${files[0]?.path ?? ""}-${gridSize}`}
          renderItem={renderItem("grid")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-px-elevated">
          <VirtualizedGrid
            items={files}
            getKey={(f) => f.path}
            mode="list"
            itemHeight={ROW_HEIGHT}
            maxHeight="70vh"
            resetKey={files[0]?.path ?? ""}
            renderItem={renderItem("list")}
          />
        </div>
      )}

      {preview?.kind === "image" && (
        <ImageViewerModal
          img={{
            id: 0,
            path: preview.path,
            filename: preview.name,
            size: preview.size,
            width: details[preview.path]?.width ?? null,
            height: details[preview.path]?.height ?? null,
          }}
          src={api.pruneFileUrl(preview.path)}
          onClose={() => setPreview(null)}
        />
      )}
      {(preview?.kind === "video" || preview?.kind === "audio") && (
        <VideoPlayerModal
          file={asPlayable(preview, details[preview.path])}
          streamUrl={
            preview.kind === "audio" && !NATIVE_AUDIO.has(extensionOf(preview.name))
              ? api.pruneAudioUrl(preview.path)
              : api.pruneFileUrl(preview.path)
          }
          isAudio={preview.kind === "audio"}
          prepareFn={api.pruneStreamPrepare}
          statusFn={api.pruneStreamPrepareStatus}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
