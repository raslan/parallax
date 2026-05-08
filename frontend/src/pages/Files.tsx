import { useEffect, useState, useCallback, useRef } from "react";
import { Film, Loader2, ChevronLeft, ChevronRight, ImageOff, Folder, ChevronRight as Caret, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, VideoFile, Library, BrowseResponse } from "@/lib/api";
import { formatSize, formatDuration } from "@/lib/format";

const STATUS_COLORS: Record<string, string> = {
  unknown: "secondary",
  scanning: "secondary",
  clean: "default",
  corrupt: "destructive",
  queued: "secondary",
  transcoding: "secondary",
  done: "default",
  failed: "destructive",
};

const ALL_STATUSES = ["unknown", "scanning", "clean", "corrupt", "queued", "transcoding", "done", "failed"];
const PAGE_SIZE = 48;

// ─── Video player modal ───────────────────────────────────────────────────────

function VideoPlayerModal({ file, onClose }: { file: VideoFile; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/80" />
      <div
        className="relative z-10 w-full max-w-5xl px-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-white text-sm font-medium truncate pr-4" title={file.path}>
            {file.filename}
          </p>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <video
          ref={videoRef}
          src={api.streamUrl(file.id)}
          controls
          autoPlay
          className="w-full rounded-lg bg-black max-h-[80vh]"
        />
        <p className="text-white/50 text-xs text-center">
          {formatSize(file.size)}
          {file.duration ? ` · ${formatDuration(file.duration)}` : ""}
          {" · "}{file.path}
        </p>
      </div>
    </div>
  );
}

// ─── Thumbnail card ───────────────────────────────────────────────────────────

function ThumbnailCard({ file, onClick }: { file: VideoFile; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);
  return (
    <Card className="overflow-hidden cursor-pointer hover:ring-1 hover:ring-primary transition-shadow" onClick={onClick}>
      <div className="aspect-video bg-muted relative flex items-center justify-center">
        {file.has_thumbnail && !imgError ? (
          <img
            src={api.thumbnailUrl(file.id)}
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
            variant={(STATUS_COLORS[file.status] ?? "secondary") as any}
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
        </p>
      </CardContent>
    </Card>
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

// ─── Library browser (when a library is selected) ────────────────────────────

function LibraryBrowser({
  library,
  statusFilter,
  onPlay,
}: {
  library: Library;
  statusFilter: string | undefined;
  onPlay: (f: VideoFile) => void;
}) {
  const [path, setPath] = useState("");
  const [browse, setBrowse] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset to root when library changes
  useEffect(() => { setPath(""); }, [library.id]);

  useEffect(() => {
    setLoading(true);
    api.browseLibrary(library.id, path, statusFilter)
      .then(setBrowse)
      .finally(() => setLoading(false));
  }, [library.id, path, statusFilter]);

  const navigate = (subdir: string) => {
    setPath(subdir ? (path ? `${path}/${subdir}` : subdir) : "");
  };

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
                  <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider font-medium">
                    Files in this folder
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {browse.files.map((f) => <ThumbnailCard key={f.id} file={f} onClick={() => onPlay(f)} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Flat all-libraries view ──────────────────────────────────────────────────

function FlatView({ statusFilter, onPlay }: { statusFilter: string | undefined; onPlay: (f: VideoFile) => void }) {
  const [files, setFiles] = useState<VideoFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getFiles({ status: statusFilter, page, page_size: PAGE_SIZE })
      .then((res) => { setFiles(res.items); setTotal(res.total); })
      .finally(() => setLoading(false));
  }, [statusFilter, page]);

  useEffect(() => { setPage(1); }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (files.length === 0) return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <Film className="h-10 w-10 text-muted-foreground mb-4" />
        <h3 className="font-semibold text-lg mb-1">No files found</h3>
        <p className="text-sm text-muted-foreground max-w-sm">Add a library and run a scan to populate this view.</p>
      </CardContent>
    </Card>
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {files.map((f) => <ThumbnailCard key={f.id} file={f} onClick={() => onPlay(f)} />)}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button size="icon" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button size="icon" variant="outline" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Files() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();
  const [playingFile, setPlayingFile] = useState<VideoFile | null>(null);

  useEffect(() => {
    api.getLibraries().then(setLibraries).catch(() => {});
  }, []);

  const selectedLibrary = libraries.find((l) => l.id === selectedLibraryId) ?? null;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and manage video files across all libraries.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          value={selectedLibraryId}
          onChange={(e) => setSelectedLibraryId(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">All libraries (flat)</option>
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          value={selectedStatus ?? ""}
          onChange={(e) => setSelectedStatus(e.target.value || undefined)}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
      </div>

      {selectedLibrary ? (
        <LibraryBrowser library={selectedLibrary} statusFilter={selectedStatus} onPlay={setPlayingFile} />
      ) : (
        <FlatView statusFilter={selectedStatus} onPlay={setPlayingFile} />
      )}

      {playingFile && (
        <VideoPlayerModal file={playingFile} onClose={() => setPlayingFile(null)} />
      )}
    </div>
  );
}
