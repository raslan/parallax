import { useEffect, useState, useCallback, useRef } from "react";
import {
  Film,
  Loader2,
  ImageOff,
  Folder,
  ChevronRight as Caret,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  List,
  Play,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { VideoFile } from "@/types/file";
import type { Library, BrowseResponse } from "@/types/library";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";
import { useLiveFiles } from "@/hooks/useLiveFiles";

const STATUS_COLORS: Record<string, string> = {
  unknown: "secondary",
  scanning: "secondary",
  clean: "default",
  queued: "secondary",
  transcoding: "secondary",
  done: "default",
  failed: "destructive",
};

const ALL_STATUSES = ["unknown", "scanning", "clean", "queued", "transcoding", "done", "failed"];
const FETCH_ALL_PAGE_SIZE = 10000;

// ─── Thumbnail card ───────────────────────────────────────────────────────────

function ThumbnailCard({ file, onPlay }: { file: VideoFile; onPlay: () => void }) {
  const [imgError, setImgError] = useState(false);

  return (
    <Card
      className="overflow-hidden cursor-pointer group transition-shadow hover:ring-1 hover:ring-primary"
      onClick={onPlay}
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

        <div className="absolute top-1.5 right-1.5">
          <Badge
            variant={
              (STATUS_COLORS[file.status] ?? "secondary") as unknown as
                | "default"
                | "destructive"
                | "outline"
                | "secondary"
                | "success"
                | "warning"
                | null
                | undefined
            }
            className="text-xs capitalize"
          >
            {file.status}
          </Badge>
        </div>
      </div>
      <CardContent className="p-2.5 space-y-0.5">
        <p className="text-xs font-medium truncate" title={file.filename}>
          {file.filename}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatSize(file.size)}
          {file.duration ? ` · ${formatDuration(file.duration)}` : ""}
          {file.codec_name ? ` · ${file.codec_name.toUpperCase()}` : ""}
          {file.video_bitrate ? ` · ${formatBitrate(file.video_bitrate)}` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── List row ────────────────────────────────────────────────────────────────

function FileListRow({ file, onPlay }: { file: VideoFile; onPlay: () => void }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer transition-colors group/row"
      onClick={onPlay}
    >
      <div className="relative h-8 w-14 shrink-0">
        {file.has_thumbnail && !imgError ? (
          <img
            src={api.thumbnailUrl(file.id, file.scanned_at ?? undefined)}
            alt={file.filename}
            className="h-8 w-14 object-cover rounded"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="h-8 w-14 bg-muted rounded flex items-center justify-center">
            <ImageOff className="h-3.5 w-3.5 text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium" title={file.filename}>
          {file.filename}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={file.path}>
          {file.path}
        </p>
      </div>
      <div className="w-24 shrink-0">
        <Badge
          variant={
            (STATUS_COLORS[file.status] ?? "secondary") as
              "default" | "destructive" | "outline" | "secondary" | "success" | "warning"
          }
          className="text-xs capitalize"
        >
          {file.status}
        </Badge>
      </div>
      <span className="w-16 shrink-0 text-right tabular-nums text-xs text-muted-foreground font-mono">
        {file.codec_name ? file.codec_name.toUpperCase() : "—"}
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums text-xs text-muted-foreground font-mono">
        {formatDuration(file.duration)}
      </span>
      <span className="w-20 shrink-0 text-right tabular-nums text-xs text-muted-foreground font-mono">
        {file.video_bitrate ? formatBitrate(file.video_bitrate) : "—"}
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums text-xs text-muted-foreground">
        {formatSize(file.size)}
      </span>
      <div className="w-14 shrink-0 flex items-center justify-end gap-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          title="Play video"
          className="text-muted-foreground hover:text-foreground"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function FileListHeader() {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider rounded-t-lg">
      <div className="w-14 shrink-0" />
      <div className="flex-1">Filename</div>
      <div className="w-24 shrink-0">Status</div>
      <div className="w-16 shrink-0 text-right">Codec</div>
      <div className="w-16 shrink-0 text-right">Duration</div>
      <div className="w-20 shrink-0 text-right">Bitrate</div>
      <div className="w-16 shrink-0 text-right">Size</div>
      <div className="w-14 shrink-0" />
    </div>
  );
}

// ─── Directory card ───────────────────────────────────────────────────────────

function DirCard({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm hover:bg-accent transition-colors text-left w-full"
    >
      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate flex-1">{name}</span>
      <Caret className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  library,
  path,
  onNavigate,
}: {
  library: Library;
  path: string;
  onNavigate: (p: string) => void;
}) {
  const parts = path ? path.split("/") : [];
  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap">
      <button
        onClick={() => onNavigate("")}
        className="text-primary hover:underline font-medium truncate max-w-[160px]"
        title={library.name}
      >
        {library.name}
      </button>
      {parts.map((part, i) => {
        const segPath = parts.slice(0, i + 1).join("/");
        const isLast = i === parts.length - 1;
        return (
          <span key={segPath} className="flex items-center gap-1">
            <Caret className="h-3.5 w-3.5 text-muted-foreground" />
            {isLast ? (
              <span className="text-foreground truncate max-w-[200px]">{part}</span>
            ) : (
              <button
                onClick={() => onNavigate(segPath)}
                className="text-primary hover:underline truncate max-w-[200px]"
              >
                {part}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ─── Library browser ──────────────────────────────────────────────────────────

function LibraryBrowser({
  library,
  statusFilter,
  sortBy,
  sortDir,
  viewMode,
  search,
  onPlay,
  refreshToken,
}: {
  library: Library;
  statusFilter: string | undefined;
  sortBy: string;
  sortDir: string;
  viewMode: "grid" | "list";
  search: string;
  onPlay: (f: VideoFile) => void;
  refreshToken: number;
}) {
  const [path, setPath] = useState("");
  const [browse, setBrowse] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Intentional setState in effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPath("");
  }, [library.id]);

  useEffect(() => {
    // Intentional setState in effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!browse) setLoading(true);
    api
      .browseLibrary(library.id, path, statusFilter, sortBy, sortDir)
      .then(setBrowse)
      .finally(() => setLoading(false));
  }, [library.id, path, statusFilter, sortBy, sortDir, refreshToken]);

  const navigate = (subdir: string) => setPath(subdir ? (path ? `${path}/${subdir}` : subdir) : "");

  return (
    <div className="space-y-4">
      <Breadcrumb library={library} path={path} onNavigate={setPath} />
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !browse || (browse.dirs.length === 0 && browse.files.length === 0) ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Film className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {statusFilter ? "No files match this filter here." : "No files in this folder."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {browse.dirs.length > 0 && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {browse.dirs.map((dir) => (
                <DirCard key={dir} name={dir} onClick={() => navigate(dir)} />
              ))}
            </div>
          )}
          {browse.files.length > 0 && (
            <>
              {browse.dirs.length > 0 && (
                <div className="border-t pt-4">
                  <SectionHeader>Files in this folder</SectionHeader>
                </div>
              )}
              {(() => {
                const visibleFiles = search.trim()
                  ? browse.files.filter((f) =>
                      f.filename.toLowerCase().includes(search.toLowerCase()),
                    )
                  : browse.files;
                return viewMode === "grid" ? (
                  <VirtualizedGrid
                    items={visibleFiles}
                    getKey={(f) => f.id}
                    mode="grid"
                    itemHeight={200}
                    itemAspectRatio={16 / 9}
                    itemChromeHeight={58}
                    dynamicHeight
                    minColumnWidth={180}
                    maxHeight="60vh"
                    resetKey={`${library.id}-${path}-${statusFilter}-${sortBy}-${sortDir}-${search}`}
                    renderItem={(f) => <ThumbnailCard file={f} onPlay={() => onPlay(f)} />}
                  />
                ) : (
                  <div className="flex flex-col rounded-lg border border-border overflow-hidden">
                    <FileListHeader />
                    <VirtualizedGrid
                      items={visibleFiles}
                      getKey={(f) => f.id}
                      mode="list"
                      itemHeight={54}
                      dynamicHeight
                      maxHeight="60vh"
                      resetKey={`${library.id}-${path}-${statusFilter}-${sortBy}-${sortDir}-${search}`}
                      renderItem={(f) => <FileListRow file={f} onPlay={() => onPlay(f)} />}
                    />
                  </div>
                );
              })()}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Flat all-libraries view ──────────────────────────────────────────────────

function FlatView({
  statusFilter,
  sortBy,
  sortDir,
  viewMode,
  search,
  onPlay,
  refreshToken,
}: {
  statusFilter: string | undefined;
  sortBy: string;
  sortDir: string;
  viewMode: "grid" | "list";
  search: string;
  onPlay: (f: VideoFile) => void;
  refreshToken: number;
}) {
  const [files, setFiles] = useState<VideoFile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const load = useCallback(() => {
    if (!hasLoadedRef.current) setLoading(true);
    api
      .getFiles({
        status: statusFilter,
        page: 1,
        page_size: FETCH_ALL_PAGE_SIZE,
        sort_by: sortBy,
        sort_dir: sortDir,
      })
      .then((res) => {
        setFiles(res.items);
        setTotal(res.total);
        hasLoadedRef.current = true;
      })
      .finally(() => setLoading(false));
  }, [statusFilter, sortBy, sortDir, refreshToken]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );

  const visibleFiles = search.trim()
    ? files.filter((f) => f.filename.toLowerCase().includes(search.toLowerCase()))
    : files;

  if (visibleFiles.length === 0)
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Film className="h-10 w-10 text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-1">No files found</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            {search.trim()
              ? "No files match your search."
              : "Add a library and run a scan to populate this view."}
          </p>
        </CardContent>
      </Card>
    );

  return (
    <>
      {total > files.length && (
        <p className="text-xs text-muted-foreground">
          Showing first {files.length.toLocaleString()} of {total.toLocaleString()} files — narrow
          your filter to see more.
        </p>
      )}
      {viewMode === "grid" ? (
        <VirtualizedGrid
          items={visibleFiles}
          getKey={(f) => f.id}
          mode="grid"
          itemHeight={200}
          itemAspectRatio={16 / 9}
          itemChromeHeight={58}
          dynamicHeight
          minColumnWidth={180}
          maxHeight="70vh"
          resetKey={`${statusFilter}-${sortBy}-${sortDir}-${search}`}
          renderItem={(f) => <ThumbnailCard file={f} onPlay={() => onPlay(f)} />}
        />
      ) : (
        <div className="flex flex-col rounded-lg border border-border overflow-hidden">
          <FileListHeader />
          <VirtualizedGrid
            items={visibleFiles}
            getKey={(f) => f.id}
            mode="list"
            itemHeight={54}
            dynamicHeight
            maxHeight="60vh"
            resetKey={`${statusFilter}-${sortBy}-${sortDir}-${search}`}
            renderItem={(f) => <FileListRow file={f} onPlay={() => onPlay(f)} />}
          />
        </div>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: "filename", label: "Name" },
  { value: "extension", label: "Extension" },
  { value: "size", label: "Size" },
  { value: "duration", label: "Duration" },
  { value: "video_bitrate", label: "Bitrate" },
  { value: "created_at", label: "Date added" },
];

const selectCls =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

export function Files() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();
  const [sortBy, setSortBy] = useState("filename");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [playingFile, setPlayingFile] = useState<VideoFile | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    api
      .getLibraries()
      .then(setLibraries)
      .catch(() => {});
  }, []);

  const selectedLibrary = libraries.find((l) => l.id === selectedLibraryId) ?? null;

  useLiveFiles("video", selectedLibrary?.id ?? null, () => setRefreshToken((t) => t + 1));

  return (
    <div className="p-8 space-y-6">
      <div>
        <SectionHeader className="mb-1.5">Indexed media</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and manage video files across all libraries.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={selectCls}
          value={selectedLibraryId}
          onChange={(e) =>
            setSelectedLibraryId(e.target.value === "all" ? "all" : Number(e.target.value))
          }
        >
          <option value="all">All libraries (flat)</option>
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={selectedStatus ?? ""}
          onChange={(e) => setSelectedStatus(e.target.value || undefined)}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </select>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${selectCls} pl-7 w-44`}
          />
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <select className={selectCls} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )}
          </button>

          <div className="flex items-center rounded-md border border-input overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`h-8 w-8 flex items-center justify-center transition-colors ${viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
              title="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`h-8 w-8 flex items-center justify-center transition-colors ${viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
              title="List view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {selectedLibrary ? (
        <LibraryBrowser
          library={selectedLibrary}
          statusFilter={selectedStatus}
          sortBy={sortBy}
          sortDir={sortDir}
          viewMode={viewMode}
          search={search}
          onPlay={setPlayingFile}
          refreshToken={refreshToken}
        />
      ) : (
        <FlatView
          statusFilter={selectedStatus}
          sortBy={sortBy}
          sortDir={sortDir}
          viewMode={viewMode}
          search={search}
          onPlay={setPlayingFile}
          refreshToken={refreshToken}
        />
      )}

      {playingFile && (
        <VideoPlayerModal
          file={playingFile}
          streamUrl={api.streamUrl(playingFile.id)}
          subtitleTracksUrl={api.subtitleTracksUrl(playingFile.id)}
          onClose={() => setPlayingFile(null)}
        />
      )}
    </div>
  );
}
