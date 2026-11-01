import { useState } from "react";
import { FileIcon, Film, FolderOpen, ImageIcon, Music } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { FileGridCard, FileListRow } from "@/components/FileSelectGrid";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import type { ViewMode } from "@/components/DataToolbar";
import { GridSkeleton, ListSkeleton } from "@/components/Skeletons";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { DetailsProgress } from "@/components/prune/DetailsProgress";
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

// Real heights of the shared FileGridCard footer (filename + one meta line) and
// FileListRow (~48px + border); Compress/Toolbox use the same numbers.
const CARD_CHROME = 48;
const ROW_HEIGHT = 50;

type DetailsMap = Record<string, FileDetails | null>;

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/**
 * Stand-in for the library-row shape the modals and the shared card/row read
 * (`id` is unused: a custom thumbnail is always passed).
 */
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
function Meta({
  d,
  loading,
  className,
}: {
  d: FileDetails | null | undefined;
  loading: boolean;
  className?: string;
}) {
  if (d === undefined) {
    return loading ? <Skeleton className="h-3 w-24 shrink-0" /> : null;
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
    <span className={cn("animate-fade-in truncate font-mono tabular-nums", className)}>
      {parts.join(" · ")}
    </span>
  );
}

/** Delete exit animation (before the refetch drops the row) + the enter fade. */
function motionClass(layout: "grid" | "list", leaving: boolean) {
  return cn(
    "animate-slide-up-fade",
    leaving &&
      (layout === "grid"
        ? "pointer-events-none scale-95 opacity-0 transition-all duration-200 motion-reduce:scale-100"
        : "pointer-events-none -translate-x-2 opacity-0 transition-all duration-200 motion-reduce:translate-x-0"),
  );
}

/**
 * The open folder's direct files as a thumbnail grid or list, with click-to-preview
 * (video/audio in the player modal, images in the lightbox). Renders the app's shared
 * `FileGridCard` / `FileListRow`, passing Prune's path thumbnail and details line in
 * through their slots. Props-in/callbacks-out: `files` arrives already filtered
 * (undefined = loading) and `details` streams in from `usePruneDetails`. Selection is
 * optional (`selected` + `onToggleSelect`); `leaving` paths play the delete exit
 * animation before the list refetches. `filtered` swaps the empty-state copy when a
 * filter hides everything.
 */
export function FileBrowser({
  files,
  details,
  progress,
  selected,
  leaving,
  onToggleSelect,
  filtered,
  viewMode,
  cardSize,
  scrollElement,
  marquee,
}: {
  files: PruneFile[] | undefined;
  details: DetailsMap;
  progress: { loaded: number; total: number; done: boolean };
  /** Grid or list; owned by the page so folders and files share one toggle. */
  viewMode: ViewMode;
  /** Shared card size (px); owned by the page. */
  cardSize: number;
  /**
   * The page scroller the grid virtualises against (null while it is being found).
   * Omit it and the grid owns its own scroller.
   */
  scrollElement?: HTMLElement | null;
  /** Drag-to-select handlers (`marqueeProps` from `useSelection`); omit to disable. */
  marquee?: {
    onMarqueeStart: (additive: boolean) => void;
    onMarquee: (keys: readonly (string | number)[]) => void;
  };
  selected?: ReadonlySet<string>;
  leaving?: ReadonlySet<string>;
  onToggleSelect?: (file: PruneFile) => void;
  /** True when a filter is active, so an empty list reads as "nothing matches". */
  filtered?: boolean;
}) {
  // Without a shared page scroller the grid owns one, capped so it doesn't run away.
  const own =
    scrollElement === undefined
      ? { maxHeight: "70vh", resetKey: `${files?.[0]?.path ?? ""}-${cardSize}-${viewMode}` }
      : {};
  const [preview, setPreview] = useState<PruneFile | null>(null);

  const detailsLoading = !progress.done;
  const none: ReadonlySet<string> = new Set();
  const sel = selected ?? none;

  const shared = (f: PruneFile) => ({
    file: asPlayable(f, details[f.path]),
    selected: sel.has(f.path),
    selectable: onToggleSelect !== undefined,
    onToggle: () => onToggleSelect?.(f),
    onPlay: () => setPreview(f),
    playable: f.kind !== "other",
  });

  const renderGrid = (f: PruneFile) => (
    <FileGridCard
      {...shared(f)}
      className={motionClass("grid", leaving?.has(f.path) ?? false)}
      thumbnail={<Thumb file={f} className="h-full w-full" />}
      footer={
        <div className="flex min-w-0 items-center gap-2 text-3xs text-muted-foreground">
          <span className="shrink-0">{formatSize(f.size)}</span>
          <Meta d={details[f.path]} loading={detailsLoading} className="min-w-0" />
        </div>
      }
    />
  );

  const renderList = (f: PruneFile) => (
    <FileListRow
      {...shared(f)}
      className={motionClass("list", leaving?.has(f.path) ?? false)}
      thumbnail={<Thumb file={f} className="h-8 w-14 rounded" />}
      columns={
        <>
          <Meta
            d={details[f.path]}
            loading={detailsLoading}
            className="hidden max-w-[45%] shrink text-right text-xs text-muted-foreground/60 sm:block"
          />
          <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground/70">
            {formatSize(f.size)}
          </span>
        </>
      }
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Files{files ? ` · ${files.length.toLocaleString()}` : ""}
          </h2>
          <DetailsProgress {...progress} />
        </div>
      </div>

      {!files ? (
        viewMode === "grid" ? (
          <GridSkeleton count={8} minColumnWidth={cardSize} />
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
          itemHeight={CARD_CHROME + cardSize * 0.75}
          itemAspectRatio={4 / 3}
          itemChromeHeight={CARD_CHROME}
          minColumnWidth={cardSize}
          scrollElement={scrollElement}
          {...own}
          {...marquee}
          renderItem={renderGrid}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-px-elevated">
          <VirtualizedGrid
            items={files}
            getKey={(f) => f.path}
            mode="list"
            itemHeight={ROW_HEIGHT}
            scrollElement={scrollElement}
            {...own}
            {...marquee}
            renderItem={renderList}
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
