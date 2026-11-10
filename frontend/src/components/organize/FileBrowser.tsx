import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { ColHeader, FileGridCard, FileListRow, type SortDir } from "@/components/FileSelectGrid";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { SectionHeader } from "@/components/SectionHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import type { ViewMode } from "@/components/DataToolbar";
import { GridSkeleton, ListSkeleton } from "@/components/Skeletons";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { DetailsProgress } from "@/components/organize/DetailsProgress";
import { KIND_ICON } from "@/components/organize/kindIcon";
import { formatBitrate, formatDuration, formatSize, formatUnixDate } from "@/lib/format";
import { extensionOf } from "@/lib/path";
import { REDACTED_FILE } from "@/lib/organizeRedact";
import type { FileSortKey } from "@/lib/organizeSort";
import { TAG_LABELS, TAG_SORT_KEY, type TagColumnId } from "@/lib/organizeTags";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/Tip";
import type { FileDetails, OrganizeFile, OrganizeTagInfo } from "@/types/organize";

/** Breakpoint visibility per column: [cell class, header class] (the header is flex). */
const SHOW = {
  always: ["", ""],
  sm: ["hidden sm:block", "hidden sm:flex"],
  md: ["hidden md:block", "hidden md:flex"],
  lg: ["hidden lg:block", "hidden lg:flex"],
} as const;

/**
 * The list view's columns after the name, shared by the rows and the header so they
 * line up. `detail` columns read the streamed ffprobe details (shimmer while loading).
 */
const COLUMNS: {
  key: FileSortKey;
  label: string;
  width: string;
  show: keyof typeof SHOW;
  detail: boolean;
  value: (f: OrganizeFile, d: FileDetails | null | undefined) => string;
}[] = [
  {
    key: "added",
    label: "Added",
    width: "w-24",
    show: "lg",
    detail: false,
    value: (f) => formatUnixDate(f.mtime),
  },
  {
    key: "duration",
    label: "Duration",
    width: "w-14",
    show: "sm",
    detail: true,
    value: (_f, d) => formatDuration(d?.duration ?? null),
  },
  {
    key: "resolution",
    label: "Resolution",
    width: "w-20",
    show: "md",
    detail: true,
    value: (_f, d) => (d?.width && d.height ? `${d.width}×${d.height}` : "—"),
  },
  {
    key: "codec",
    label: "Codec",
    width: "w-14",
    show: "md",
    detail: true,
    value: (_f, d) => d?.codec ?? "—",
  },
  {
    key: "bitrate",
    label: "Bitrate",
    width: "w-20",
    show: "lg",
    detail: true,
    value: (_f, d) => formatBitrate(d?.bitrate ?? null),
  },
  {
    key: "size",
    label: "Size",
    width: "w-16",
    show: "always",
    detail: false,
    value: (f) => formatSize(f.size),
  },
];

/** Width and visibility of a tag column; shared by its cells and its header. */
const TAG_CELL = "hidden w-44 shrink-0 md:block";
const TAG_HEAD = "hidden w-44 shrink-0 md:flex";

/**
 * One tag value in the list: a single truncated line (new lines collapse to spaces, so a
 * hashtag-heavy description never makes the row taller), the full text on hover, "—" when
 * the file has none, a shimmer until its tags arrive. Redacting hides the value and its
 * hover text.
 */
function TagCell({
  id,
  path,
  info,
  loading,
  redact,
}: {
  id: TagColumnId;
  path: string;
  info: OrganizeTagInfo | null | undefined;
  loading: boolean;
  redact: boolean;
}) {
  if (info === undefined) {
    return loading ? <Skeleton className={cn(TAG_CELL, "h-3")} /> : <span className={TAG_CELL} />;
  }
  const value = info?.fields[id];
  const cls = cn(
    TAG_CELL,
    "animate-fade-in truncate text-xs",
    value ? "text-muted-foreground" : "text-muted-foreground/60",
  );
  const cell = (text: string) => (
    <span data-testid={`tag-${id}-${path}`} className={cls}>
      {text}
    </span>
  );
  if (!value) return cell("—");
  if (redact) return cell("Redacted");
  return (
    <Tip label={<span className="block max-w-sm break-words">{value}</span>}>
      {cell(value.replace(/\s+/g, " "))}
    </Tip>
  );
}

/** Chrome plays these natively; the backend 400s `/organize/audio` for them. */
const NATIVE_AUDIO = new Set(["mp3", "m4a", "aac", "ogg", "opus", "wav", "flac"]);

// Real heights of the shared FileGridCard footer (filename + one meta line) and
// FileListRow (~48px + border); Compress/Toolbox use the same numbers.
const CARD_CHROME = 48;
const ROW_HEIGHT = 50;

type DetailsMap = Record<string, FileDetails | null>;

/**
 * Stand-in for the library-row shape the modals and the shared card/row read
 * (`id` is unused: a custom thumbnail is always passed).
 */
function asPlayable(file: OrganizeFile, d: FileDetails | null | undefined, redact = false) {
  return {
    id: 0,
    filename: redact ? REDACTED_FILE : file.name,
    path: file.path,
    size: file.size,
    duration: d?.duration ?? null,
    codec_name: d?.codec ?? null,
    video_bitrate: d?.bitrate ?? null,
  };
}

/** Thumbnail that fades in once loaded; the kind icon shows until then and when there is none. */
function Thumb({
  file,
  className,
  redact = false,
}: {
  file: OrganizeFile;
  className?: string;
  redact?: boolean;
}) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const Icon = KIND_ICON[file.kind];
  // Audio and "other" never have thumbnails, so don't ask (and don't 404). Redacted
  // mode never asks either: only the kind icon shows.
  const hasThumb = !redact && (file.kind === "image" || file.kind === "video");
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
          src={api.organizeThumbnailUrl(file.path)}
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
    return loading ? <Skeleton className={cn("h-3 w-24 shrink-0", className)} /> : null;
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
        ? "pointer-events-none scale-95 opacity-0 transition-[transform,opacity] duration-150 ease-in motion-reduce:scale-100"
        : "pointer-events-none -translate-x-2 opacity-0 transition-[transform,opacity] duration-150 ease-in motion-reduce:translate-x-0"),
  );
}

/**
 * The open folder's direct files as a thumbnail grid or list, with click-to-preview
 * (video/audio in the player modal, images in the lightbox). Renders the app's shared
 * `FileGridCard` / `FileListRow`, passing Organize's path thumbnail and details line in
 * through their slots. Props-in/callbacks-out: `files` arrives already filtered
 * (undefined = loading) and `details` streams in from `useOrganizeDetails`. Selection is
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
  sortKey,
  sortDir,
  onSort,
  redact = false,
  tagColumns = [],
  tags = {},
  tagsLoading = false,
}: {
  /** Already filtered and sorted by the page (undefined = loading). */
  files: OrganizeFile[] | undefined;
  /** List view: which tags show as columns after the name, and the tags streamed so far. */
  tagColumns?: TagColumnId[];
  tags?: Record<string, OrganizeTagInfo | null>;
  tagsLoading?: boolean;
  /** Demo mode: "Redacted file" names, no thumbnails, no real names in the viewers. */
  redact?: boolean;
  /**
   * The page's sort (`useSort`): in list view a `ColHeader` row (the dropdown lives in
   * the page's `BrowseControls`). Omit `onSort` for no sort controls.
   */
  sortKey?: FileSortKey;
  sortDir?: SortDir;
  onSort?: (key: FileSortKey) => void;
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
  onToggleSelect?: (file: OrganizeFile) => void;
  /** True when a filter is active, so an empty list reads as "nothing matches". */
  filtered?: boolean;
}) {
  // Without a shared page scroller the grid owns one, capped so it doesn't run away.
  const own =
    scrollElement === undefined
      ? { maxHeight: "70vh", resetKey: `${files?.[0]?.path ?? ""}-${cardSize}-${viewMode}` }
      : {};
  const [preview, setPreview] = useState<OrganizeFile | null>(null);

  const detailsLoading = !progress.done;
  const none: ReadonlySet<string> = new Set();
  const sel = selected ?? none;

  const shared = (f: OrganizeFile) => ({
    file: asPlayable(f, details[f.path], redact),
    selected: sel.has(f.path),
    selectable: onToggleSelect !== undefined,
    onToggle: () => onToggleSelect?.(f),
    onPlay: () => setPreview(f),
    playable: f.kind !== "other",
  });

  const renderGrid = (f: OrganizeFile) => (
    <FileGridCard
      {...shared(f)}
      className={motionClass("grid", leaving?.has(f.path) ?? false)}
      thumbnail={<Thumb file={f} redact={redact} className="h-full w-full" />}
      footer={
        <div className="flex min-w-0 items-center gap-2 text-3xs text-muted-foreground">
          <span className="shrink-0">{formatSize(f.size)}</span>
          <Meta d={details[f.path]} loading={detailsLoading} className="min-w-0" />
        </div>
      }
    />
  );

  const renderList = (f: OrganizeFile) => (
    <FileListRow
      {...shared(f)}
      className={motionClass("list", leaving?.has(f.path) ?? false)}
      thumbnail={<Thumb file={f} redact={redact} className="h-8 w-14 rounded" />}
      columns={[
        ...tagColumns.map((id) => (
          <TagCell
            key={`tag-${id}`}
            id={id}
            path={f.path}
            info={tags[f.path]}
            loading={tagsLoading}
            redact={redact}
          />
        )),
        ...COLUMNS.map((c) => {
          const d = details[f.path];
          const cls = cn(c.width, "shrink-0", SHOW[c.show][0]);
          if (c.detail && d === undefined && detailsLoading) {
            return <Skeleton key={c.key} className={cn(cls, "h-3")} />;
          }
          return (
            <span
              key={c.key}
              className={cn(
                cls,
                "truncate text-right font-mono text-xs tabular-nums",
                c.key === "size" ? "text-muted-foreground/70" : "text-muted-foreground/60",
                c.detail && "animate-fade-in",
              )}
            >
              {c.value(f, d)}
            </span>
          );
        }),
      ]}
    />
  );

  const selectable = onToggleSelect !== undefined;
  const listHeader = onSort && sortKey && sortDir && (
    // Mirrors FileListRow's layout: checkbox, thumbnail well, name, then COLUMNS.
    <div className="flex items-center gap-3 border-b border-border/30 bg-muted/20 py-1.5 pl-4 pr-10 md:pr-4">
      {selectable && <span className="w-4 shrink-0" />}
      <span className="w-14 shrink-0" />
      <ColHeader
        label="Name"
        sortKey="name"
        current={sortKey}
        dir={sortDir}
        onSort={onSort}
        className="min-w-0 flex-1"
      />
      {tagColumns.map((id) => {
        const key = TAG_SORT_KEY[id];
        return key ? (
          <ColHeader
            key={`tag-${id}`}
            label={TAG_LABELS[id]}
            sortKey={key}
            current={sortKey}
            dir={sortDir}
            onSort={onSort}
            className={TAG_HEAD}
          />
        ) : (
          <span
            key={`tag-${id}`}
            className={cn(
              TAG_HEAD,
              "items-center text-3xs uppercase tracking-wider text-muted-foreground/40",
            )}
          >
            {TAG_LABELS[id]}
          </span>
        );
      })}
      {COLUMNS.map((c) => (
        <ColHeader
          key={c.key}
          label={c.label}
          sortKey={c.key}
          current={sortKey}
          dir={sortDir}
          onSort={onSort}
          className={cn(c.width, "shrink-0 justify-end", SHOW[c.show][1])}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <SectionHeader>Files{files ? ` · ${files.length.toLocaleString()}` : ""}</SectionHeader>
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
          {listHeader}
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
            filename: redact ? REDACTED_FILE : preview.name,
            size: preview.size,
            width: details[preview.path]?.width ?? null,
            height: details[preview.path]?.height ?? null,
          }}
          src={api.organizeFileUrl(preview.path)}
          onClose={() => setPreview(null)}
        />
      )}
      {(preview?.kind === "video" || preview?.kind === "audio") && (
        <VideoPlayerModal
          file={asPlayable(preview, details[preview.path], redact)}
          streamUrl={
            preview.kind === "audio" && !NATIVE_AUDIO.has(extensionOf(preview.name))
              ? api.organizeAudioUrl(preview.path)
              : api.organizeFileUrl(preview.path)
          }
          isAudio={preview.kind === "audio"}
          prepareFn={api.organizeStreamPrepare}
          statusFn={api.organizeStreamPrepareStatus}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
