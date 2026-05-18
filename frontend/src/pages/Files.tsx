import { useEffect, useState, useCallback } from "react";
import { Film, Loader2, ChevronLeft, ChevronRight, ImageOff, Folder, ChevronRight as Caret, X, ShieldCheck, Wand2, AlertCircle, ArrowUp, ArrowDown, LayoutGrid, List } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, VideoFile, Library, BrowseResponse } from "@/lib/api";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { PRESETS } from "@/lib/presets";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";

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

// ─── Thumbnail card ───────────────────────────────────────────────────────────


// ─── Error detail modal ───────────────────────────────────────────────────────

const VIDEO_CODECS = ["h264", "hevc", "h265", "mpeg4", "mpeg2", "vp8", "vp9", "av1", "vc1"];
const AUDIO_CODECS = ["aac", "mp3", "ac3", "opus", "vorbis", "flac", "dts", "eac3", "truehd"];

function parseErrorLines(errorText: string) {
  const lines = errorText.split("\n").filter((l) => l.startsWith("["));
  const cats: Record<string, number> = {};
  for (const line of lines) {
    const m = line.match(/^\[([^\s@\]]+)/);
    const codec = m ? m[1].toLowerCase() : "";
    let cat = "Container / other";
    if (VIDEO_CODECS.some((c) => codec.includes(c))) cat = "Video decode errors";
    else if (AUDIO_CODECS.some((c) => codec.includes(c))) cat = "Audio decode errors";
    cats[cat] = (cats[cat] ?? 0) + 1;
  }
  return { lines, summary: Object.entries(cats) };
}

function CorruptionDetailModal({ file, onClose }: { file: VideoFile; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const { lines, summary } = parseErrorLines(file.scan_error ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/70" />
      <div
        className="relative z-10 w-full max-w-2xl mx-4 bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <h2 className="font-semibold text-sm">Corruption details</h2>
            </div>
            <p className="text-xs text-muted-foreground truncate" title={file.path}>{file.filename}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {summary.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
            {summary.map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-1.5 rounded-md bg-destructive/10 border border-destructive/20 px-2.5 py-1">
                <span className="text-destructive text-xs font-medium">{count}</span>
                <span className="text-xs text-muted-foreground">{cat}</span>
              </div>
            ))}
          </div>
        )}

        <div className="overflow-auto flex-1 p-4">
          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">No detailed error output available.</p>
          ) : (
            <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
              {lines.join("\n")}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function ThumbnailCard({ file, onClick }: { file: VideoFile; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [transcoding, setTranscoding] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const isCorrupt = file.status === "corrupt";

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChecking(true);
    try {
      await api.checkFile(file.id);
    } catch {
      // 409 = already running, silently ignore
    } finally {
      setChecking(false);
    }
  };

  const handleTranscode = async (e: React.MouseEvent, preset: string) => {
    e.stopPropagation();
    setPresetOpen(false);
    setTranscoding(true);
    try {
      await api.transcodeFile(file.id, preset);
    } catch {
      // 409 = already running, silently ignore
    } finally {
      setTranscoding(false);
    }
  };

  const togglePreset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPresetOpen((v) => !v);
  };

  return (
    <Card
      className={`overflow-hidden cursor-pointer group transition-shadow hover:ring-1 ${isCorrupt ? "ring-1 ring-destructive/60 hover:ring-destructive" : "hover:ring-primary"}`}
      onClick={() => { if (!presetOpen) onClick(); }}
    >
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

        {/* Action buttons — visible on hover */}
        <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isCorrupt && file.scan_error && (
            <button
              onClick={(e) => { e.stopPropagation(); setPresetOpen(false); setErrorOpen(true); }}
              title="View corruption details"
              className="bg-black/60 hover:bg-black/80 rounded p-1"
            >
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            </button>
          )}
          <button
            onClick={handleCheck}
            disabled={checking}
            title="Check for corruption"
            className="bg-black/60 hover:bg-black/80 rounded p-1"
          >
            <ShieldCheck className={`h-3.5 w-3.5 text-white ${checking ? "animate-pulse" : ""}`} />
          </button>
          <button
            onClick={togglePreset}
            disabled={transcoding}
            title="Transcode"
            className={`bg-black/60 hover:bg-black/80 rounded p-1 ${presetOpen ? "bg-black/80" : ""}`}
          >
            <Wand2 className={`h-3.5 w-3.5 text-white ${transcoding ? "animate-pulse" : ""}`} />
          </button>
        </div>

        {/* Preset picker overlay */}
        {presetOpen && (
          <div
            className="absolute inset-0 bg-black/70 flex items-center justify-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {PRESETS.map((p) => (
              <button
                key={p.value}
                title={p.title}
                onClick={(e) => handleTranscode(e, p.value)}
                className="bg-white/10 hover:bg-white/25 border border-white/20 rounded px-2 py-1 text-white text-xs font-semibold transition-colors"
              >
                {p.shortLabel}
              </button>
            ))}
          </div>
        )}
      </div>
      <CardContent className="p-2.5 space-y-0.5">
        <p className={`text-xs font-medium truncate ${isCorrupt ? "text-destructive" : ""}`} title={file.filename}>
          {file.filename}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatSize(file.size)}
          {file.duration ? ` · ${formatDuration(file.duration)}` : ""}
          {file.codec_name ? ` · ${file.codec_name.toUpperCase()}` : ""}
          {file.video_bitrate ? ` · ${formatBitrate(file.video_bitrate)}` : ""}
        </p>
      </CardContent>

      {errorOpen && (
        <CorruptionDetailModal file={file} onClose={() => setErrorOpen(false)} />
      )}
    </Card>
  );
}

// ─── List row ────────────────────────────────────────────────────────────────

function FileListRow({ file, onPlay }: { file: VideoFile; onPlay: () => void }) {
  const [imgError, setImgError] = useState(false);
  const [checking, setChecking] = useState(false);
  const isCorrupt = file.status === "corrupt";

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChecking(true);
    try { await api.checkFile(file.id); } catch { /* 409 = already running */ } finally { setChecking(false); }
  };

  return (
    <tr
      className={`hover:bg-muted/20 cursor-pointer transition-colors border-b border-border last:border-0 ${isCorrupt ? "text-destructive" : ""}`}
      onClick={onPlay}
    >
      <td className="px-2 py-1.5">
        <div className="relative h-8 w-14 shrink-0">
          {file.has_thumbnail && !imgError ? (
            <img
              src={api.thumbnailUrl(file.id)}
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
      </td>
      <td className="px-3 py-2 max-w-xs">
        <p className={`truncate text-sm font-medium ${isCorrupt ? "text-destructive" : ""}`} title={file.filename}>{file.filename}</p>
        <p className="truncate text-xs text-muted-foreground" title={file.path}>{file.path}</p>
      </td>
      <td className="px-3 py-2">
        <Badge variant={(STATUS_COLORS[file.status] ?? "secondary") as any} className="text-xs capitalize">
          {file.status}
        </Badge>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
        {file.codec_name ? file.codec_name.toUpperCase() : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
        {formatDuration(file.duration)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
        {file.video_bitrate ? formatBitrate(file.video_bitrate) : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
        {formatSize(file.size)}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={handleCheck}
          disabled={checking}
          title="Check for corruption"
          className="opacity-0 group-hover/row:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          <ShieldCheck className={`h-3.5 w-3.5 ${checking ? "animate-pulse" : ""}`} />
        </button>
      </td>
    </tr>
  );
}

function FileListTable({ files, onPlay }: { files: VideoFile[]; onPlay: (f: VideoFile) => void }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
          <tr>
            <th className="w-16 px-2 py-2"></th>
            <th className="px-3 py-2 text-left">Filename</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Codec</th>
            <th className="px-3 py-2 text-right">Duration</th>
            <th className="px-3 py-2 text-right">Bitrate</th>
            <th className="px-3 py-2 text-right">Size</th>
            <th className="w-10 px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="group/rows">
          {files.map((f) => <FileListRow key={f.id} file={f} onPlay={() => onPlay(f)} />)}
        </tbody>
      </table>
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

// ─── Library browser (when a library is selected) ────────────────────────────

function LibraryBrowser({
  library,
  statusFilter,
  sortBy,
  sortDir,
  viewMode,
  onPlay,
}: {
  library: Library;
  statusFilter: string | undefined;
  sortBy: string;
  sortDir: string;
  viewMode: "grid" | "list";
  onPlay: (f: VideoFile) => void;
}) {
  const [path, setPath] = useState("");
  const [browse, setBrowse] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset to root when library changes
  useEffect(() => { setPath(""); }, [library.id]);

  useEffect(() => {
    setLoading(true);
    api.browseLibrary(library.id, path, statusFilter, sortBy, sortDir)
      .then(setBrowse)
      .finally(() => setLoading(false));
  }, [library.id, path, statusFilter, sortBy, sortDir]);

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
              {viewMode === "grid" ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {browse.files.map((f) => <ThumbnailCard key={f.id} file={f} onClick={() => onPlay(f)} />)}
                </div>
              ) : (
                <FileListTable files={browse.files} onPlay={onPlay} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Flat all-libraries view ──────────────────────────────────────────────────

function FlatView({ statusFilter, sortBy, sortDir, viewMode, onPlay }: { statusFilter: string | undefined; sortBy: string; sortDir: string; viewMode: "grid" | "list"; onPlay: (f: VideoFile) => void }) {
  const [files, setFiles] = useState<VideoFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.getFiles({ status: statusFilter, page, page_size: PAGE_SIZE, sort_by: sortBy, sort_dir: sortDir })
      .then((res) => { setFiles(res.items); setTotal(res.total); })
      .finally(() => setLoading(false));
  }, [statusFilter, page, sortBy, sortDir]);

  useEffect(() => { setPage(1); }, [statusFilter, sortBy, sortDir]);
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
      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {files.map((f) => <ThumbnailCard key={f.id} file={f} onClick={() => onPlay(f)} />)}
        </div>
      ) : (
        <FileListTable files={files} onPlay={onPlay} />
      )}
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

const SORT_OPTIONS = [
  { value: "filename",      label: "Name" },
  { value: "size",          label: "Size" },
  { value: "duration",      label: "Duration" },
  { value: "video_bitrate", label: "Bitrate" },
  { value: "created_at",    label: "Date added" },
];

const selectCls = "h-8 rounded-md border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

export function Files() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();
  const [sortBy, setSortBy] = useState("filename");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
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

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={selectCls}
          value={selectedLibraryId}
          onChange={(e) => setSelectedLibraryId(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">All libraries (flat)</option>
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <select
          className={selectCls}
          value={selectedStatus ?? ""}
          onChange={(e) => setSelectedStatus(e.target.value || undefined)}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 ml-auto">
          <select
            className={selectCls}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc"
              ? <ArrowUp className="h-3.5 w-3.5" />
              : <ArrowDown className="h-3.5 w-3.5" />}
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
        <LibraryBrowser library={selectedLibrary} statusFilter={selectedStatus} sortBy={sortBy} sortDir={sortDir} viewMode={viewMode} onPlay={setPlayingFile} />
      ) : (
        <FlatView statusFilter={selectedStatus} sortBy={sortBy} sortDir={sortDir} viewMode={viewMode} onPlay={setPlayingFile} />
      )}

      {playingFile && (
        <VideoPlayerModal file={playingFile} onClose={() => setPlayingFile(null)} />
      )}
    </div>
  );
}
