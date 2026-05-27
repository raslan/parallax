import { useEffect, useState, useCallback } from "react";
import { Film, Loader2, ChevronLeft, ChevronRight, ImageOff, Folder, ChevronRight as Caret, X, ShieldCheck, Wand2, AlertCircle, ArrowUp, ArrowDown, LayoutGrid, List, Check, Play, Brain, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, VideoFile, Library, BrowseResponse, VideoSearchResult } from "@/lib/api";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { PRESETS } from "@/lib/presets";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";

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

const NUDENET_GROUPS = [
  { label: "Exposed", labels: ["FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED"] },
  { label: "Covered", labels: ["FEMALE_BREAST_COVERED", "FEMALE_GENITALIA_COVERED", "MALE_GENITALIA_COVERED", "BUTTOCKS_COVERED"] },
  { label: "Other",   labels: ["BELLY_EXPOSED", "ARMPITS_EXPOSED", "FEET_EXPOSED"] },
];

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

// ─── Thumbnail card ───────────────────────────────────────────────────────────

function ThumbnailCard({
  file,
  selectionMode,
  isSelected,
  onToggle,
  onPlay,
}: {
  file: VideoFile;
  selectionMode: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [transcoding, setTranscoding] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const isCorrupt = file.status === "corrupt";

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChecking(true);
    try { await api.checkFile(file.id); } catch { } finally { setChecking(false); }
  };

  const handleTranscode = async (e: React.MouseEvent, preset: string) => {
    e.stopPropagation();
    setPresetOpen(false);
    setTranscoding(true);
    try { await api.transcodeFile(file.id, preset); } catch { } finally { setTranscoding(false); }
  };

  const togglePreset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPresetOpen((v) => !v);
  };

  return (
    <Card
      className={`overflow-hidden cursor-pointer group transition-shadow hover:ring-1 ${
        isSelected
          ? "ring-2 ring-primary"
          : isCorrupt
          ? "ring-1 ring-destructive/60 hover:ring-destructive"
          : "hover:ring-primary"
      }`}
      onClick={selectionMode ? onToggle : onPlay}
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

        {/* Selection checkbox — only shown in selection mode */}
        {selectionMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`absolute top-1.5 left-1.5 z-10 h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected ? "bg-primary border-primary" : "bg-black/50 border-white/70"
            }`}
          >
            {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
          </button>
        )}

        <div className="absolute top-1.5 right-1.5">
          <Badge variant={(STATUS_COLORS[file.status] ?? "secondary") as any} className="text-xs capitalize">
            {file.status}
          </Badge>
        </div>

        {/* Hover action buttons */}
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
          {/* Play button always available even in selection mode */}
          {selectionMode && (
            <button
              onClick={(e) => { e.stopPropagation(); onPlay(); }}
              title="Play video"
              className="bg-black/60 hover:bg-black/80 rounded p-1"
            >
              <Play className="h-3.5 w-3.5 text-white" />
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
          {!selectionMode && (
            <button
              onClick={togglePreset}
              disabled={transcoding}
              title="Transcode"
              className={`bg-black/60 hover:bg-black/80 rounded p-1 ${presetOpen ? "bg-black/80" : ""}`}
            >
              <Wand2 className={`h-3.5 w-3.5 text-white ${transcoding ? "animate-pulse" : ""}`} />
            </button>
          )}
        </div>

        {/* Per-file preset picker (only outside selection mode) */}
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

      {errorOpen && <CorruptionDetailModal file={file} onClose={() => setErrorOpen(false)} />}
    </Card>
  );
}

// ─── List row ────────────────────────────────────────────────────────────────

function FileListRow({
  file,
  selectionMode,
  isSelected,
  onToggle,
  onPlay,
}: {
  file: VideoFile;
  selectionMode: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [checking, setChecking] = useState(false);
  const isCorrupt = file.status === "corrupt";

  const handleCheck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setChecking(true);
    try { await api.checkFile(file.id); } catch { } finally { setChecking(false); }
  };

  return (
    <tr
      className={`hover:bg-muted/20 cursor-pointer transition-colors border-b border-border last:border-0 group/row ${
        isSelected ? "bg-primary/5" : ""
      } ${isCorrupt ? "text-destructive" : ""}`}
      onClick={selectionMode ? onToggle : onPlay}
    >
      {/* Checkbox column — only shown in selection mode */}
      {selectionMode && (
        <td className="px-2 py-1.5 w-8">
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected ? "bg-primary border-primary" : "border-muted-foreground/40 hover:border-primary"
            }`}
          >
            {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
          </button>
        </td>
      )}
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
        <span className="font-mono">{file.codec_name ? file.codec_name.toUpperCase() : "—"}</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
        <span className="font-mono">{formatDuration(file.duration)}</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
        <span className="font-mono">{file.video_bitrate ? formatBitrate(file.video_bitrate) : "—"}</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
        {formatSize(file.size)}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
            title="Play video"
            className="text-muted-foreground hover:text-foreground"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleCheck}
            disabled={checking}
            title="Check for corruption"
            className="text-muted-foreground hover:text-foreground"
          >
            <ShieldCheck className={`h-3.5 w-3.5 ${checking ? "animate-pulse" : ""}`} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function FileListTable({
  files,
  selectionMode,
  selectedIds,
  onToggle,
  onSelectAll,
  onPlay,
}: {
  files: VideoFile[];
  selectionMode: boolean;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
  onPlay: (f: VideoFile) => void;
}) {
  const allSelected = files.length > 0 && files.every((f) => selectedIds.has(f.id));
  const someSelected = !allSelected && files.some((f) => selectedIds.has(f.id));

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
          <tr>
            {selectionMode && (
              <th className="w-8 px-2 py-2">
                <button
                  onClick={() => onSelectAll(allSelected ? [] : files.map((f) => f.id))}
                  className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-colors ${
                    allSelected
                      ? "bg-primary border-primary"
                      : someSelected
                      ? "bg-primary/40 border-primary/60"
                      : "border-muted-foreground/40 hover:border-primary"
                  }`}
                >
                  {(allSelected || someSelected) && <Check className="h-2.5 w-2.5 text-white" />}
                </button>
              </th>
            )}
            <th className="w-16 px-2 py-2"></th>
            <th className="px-3 py-2 text-left">Filename</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Codec</th>
            <th className="px-3 py-2 text-right">Duration</th>
            <th className="px-3 py-2 text-right">Bitrate</th>
            <th className="px-3 py-2 text-right">Size</th>
            <th className="w-16 px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <FileListRow
              key={f.id}
              file={f}
              selectionMode={selectionMode}
              isSelected={selectedIds.has(f.id)}
              onToggle={() => onToggle(f.id)}
              onPlay={() => onPlay(f)}
            />
          ))}
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

function Breadcrumb({ library, path, onNavigate }: { library: Library; path: string; onNavigate: (p: string) => void }) {
  const parts = path ? path.split("/") : [];
  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap">
      <button onClick={() => onNavigate("")} className="text-primary hover:underline font-medium truncate max-w-[160px]" title={library.name}>
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
              <button onClick={() => onNavigate(segPath)} className="text-primary hover:underline truncate max-w-[200px]">{part}</button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ─── Library browser ──────────────────────────────────────────────────────────

function LibraryBrowser({
  library, statusFilter, sortBy, sortDir, viewMode,
  selectionMode, selectedIds, onToggle, onSelectAll, onPlay,
}: {
  library: Library;
  statusFilter: string | undefined;
  sortBy: string;
  sortDir: string;
  viewMode: "grid" | "list";
  selectionMode: boolean;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
  onPlay: (f: VideoFile) => void;
}) {
  const [path, setPath] = useState("");
  const [browse, setBrowse] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setPath(""); }, [library.id]);

  useEffect(() => {
    setLoading(true);
    api.browseLibrary(library.id, path, statusFilter, sortBy, sortDir)
      .then(setBrowse)
      .finally(() => setLoading(false));
  }, [library.id, path, statusFilter, sortBy, sortDir]);

  const navigate = (subdir: string) => setPath(subdir ? (path ? `${path}/${subdir}` : subdir) : "");

  return (
    <div className="space-y-4">
      <Breadcrumb library={library} path={path} onNavigate={setPath} />
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !browse || (browse.dirs.length === 0 && browse.files.length === 0) ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Film className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{statusFilter ? "No files match this filter here." : "No files in this folder."}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {browse.dirs.length > 0 && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {browse.dirs.map((dir) => <DirCard key={dir} name={dir} onClick={() => navigate(dir)} />)}
            </div>
          )}
          {browse.files.length > 0 && (
            <>
              {browse.dirs.length > 0 && <div className="border-t pt-4"><SectionHeader>Files in this folder</SectionHeader></div>}
              {viewMode === "grid" ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {browse.files.map((f) => (
                    <ThumbnailCard key={f.id} file={f} selectionMode={selectionMode} isSelected={selectedIds.has(f.id)} onToggle={() => onToggle(f.id)} onPlay={() => onPlay(f)} />
                  ))}
                </div>
              ) : (
                <FileListTable files={browse.files} selectionMode={selectionMode} selectedIds={selectedIds} onToggle={onToggle} onSelectAll={onSelectAll} onPlay={onPlay} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Flat all-libraries view ──────────────────────────────────────────────────

function FlatView({
  statusFilter, sortBy, sortDir, viewMode,
  selectionMode, selectedIds, onToggle, onSelectAll, onPlay,
}: {
  statusFilter: string | undefined;
  sortBy: string;
  sortDir: string;
  viewMode: "grid" | "list";
  selectionMode: boolean;
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
  onPlay: (f: VideoFile) => void;
}) {
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
          {files.map((f) => (
            <ThumbnailCard key={f.id} file={f} selectionMode={selectionMode} isSelected={selectedIds.has(f.id)} onToggle={() => onToggle(f.id)} onPlay={() => onPlay(f)} />
          ))}
        </div>
      ) : (
        <FileListTable files={files} selectionMode={selectionMode} selectedIds={selectedIds} onToggle={onToggle} onSelectAll={onSelectAll} onPlay={onPlay} />
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
  { value: "extension",     label: "Extension" },
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

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchTranscoding, setBatchTranscoding] = useState(false);

  // AI search state
  const [aiMode, setAiMode] = useState(false);
  const [clipQuery, setClipQuery] = useState("");
  const [clipResults, setClipResults] = useState<VideoSearchResult[]>([]);
  const [checkedLabels, setCheckedLabels] = useState<Set<string>>(new Set());
  const [detectionConfidence, setDetectionConfidence] = useState(0.5);
  const [detectionResults, setDetectionResults] = useState<VideoFile[]>([]);
  const [aiSearching, setAiSearching] = useState(false);
  const [aiTab, setAiTab] = useState<"clip" | "nudenet">("clip");

  useEffect(() => { api.getLibraries().then(setLibraries).catch(() => {}); }, []);

  // Clear selection when view changes
  useEffect(() => { setSelectedIds(new Set()); }, [selectedLibraryId, selectedStatus]);

  const toggleSelectionMode = () => {
    setSelectionMode((v) => {
      if (v) setSelectedIds(new Set()); // clear on exit
      return !v;
    });
  };

  const toggleId = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: number[]) => {
    setSelectedIds(ids.length === 0 ? new Set() : new Set(ids));
  }, []);

  const handleBatchTranscode = async (preset: string) => {
    if (selectedIds.size === 0) return;
    setBatchTranscoding(true);
    try {
      await Promise.all([...selectedIds].map((id) => api.transcodeFile(id, preset).catch(() => {})));
      setSelectedIds(new Set());
    } finally {
      setBatchTranscoding(false);
    }
  };

  const runClipSearch = async () => {
    if (!clipQuery.trim()) return;
    setAiSearching(true);
    try {
      const libId = selectedLibraryId === "all" ? undefined : selectedLibraryId;
      const results = await api.searchFiles(clipQuery.trim(), libId);
      setClipResults(results);
    } finally {
      setAiSearching(false);
    }
  };

  const runDetectionFilter = async () => {
    if (checkedLabels.size === 0) return;
    setAiSearching(true);
    try {
      const libId = selectedLibraryId === "all" ? undefined : selectedLibraryId;
      const res = await api.filterFilesByDetections({
        labels: [...checkedLabels],
        min_confidence: detectionConfidence,
        library_id: libId,
        page_size: 200,
      });
      setDetectionResults(res.items);
    } finally {
      setAiSearching(false);
    }
  };

  const toggleLabel = (label: string) => {
    setCheckedLabels((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  const selectedLibrary = libraries.find((l) => l.id === selectedLibraryId) ?? null;

  return (
    <div className="p-8 space-y-6">
      <div>
        <SectionHeader className="mb-1.5">Indexed media</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse and manage video files across all libraries.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={selectCls}
          value={selectedLibraryId}
          onChange={(e) => setSelectedLibraryId(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">All libraries (flat)</option>
          {libraries.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        <select
          className={selectCls}
          value={selectedStatus ?? ""}
          onChange={(e) => setSelectedStatus(e.target.value || undefined)}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>

        <div className="flex items-center gap-1 ml-auto">
          <select className={selectCls} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
          </button>

          {/* AI Search toggle */}
          <button
            onClick={() => setAiMode((v) => !v)}
            className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors ${
              aiMode
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
            title="AI Search — CLIP semantic search + NudeNet detection filter"
          >
            <Brain className="h-3.5 w-3.5" />
            AI Search
          </button>

          {/* Transcode mode toggle */}
          <button
            onClick={toggleSelectionMode}
            className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors ${
              selectionMode
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
            title={selectionMode ? "Exit transcode selection" : "Select files to transcode"}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Transcode
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

      {/* Batch action bar — only visible in selection mode */}
      {selectionMode && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size === 0 ? "Click files to select" : `${selectedIds.size} file${selectedIds.size !== 1 ? "s" : ""} selected`}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            {selectedIds.size > 0 && (
              <>
                <span className="text-xs text-muted-foreground">Transcode as:</span>
                {PRESETS.map((p) => (
                  <Button
                    key={p.value}
                    size="sm"
                    variant="outline"
                    title={p.title}
                    onClick={() => handleBatchTranscode(p.value)}
                    disabled={batchTranscoding}
                    className="h-7 px-3 text-xs"
                  >
                    {batchTranscoding ? <Loader2 className="h-3 w-3 animate-spin" /> : p.label}
                  </Button>
                ))}
              </>
            )}
            <button
              onClick={toggleSelectionMode}
              className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Exit selection mode"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* AI Search panel */}
      {aiMode && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex gap-2 border-b border-border pb-3">
            <button
              onClick={() => setAiTab("clip")}
              className={`text-sm font-medium px-3 py-1 rounded-md transition-colors ${aiTab === "clip" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              Semantic Search
            </button>
            <button
              onClick={() => setAiTab("nudenet")}
              className={`text-sm font-medium px-3 py-1 rounded-md transition-colors ${aiTab === "nudenet" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              Content Detection
            </button>
          </div>

          {aiTab === "clip" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Search videos by description using CLIP. Requires AI scan.</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={clipQuery}
                  onChange={(e) => setClipQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runClipSearch()}
                  placeholder="e.g. beach sunset, people dancing…"
                  className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button size="sm" onClick={runClipSearch} disabled={aiSearching || !clipQuery.trim()}>
                  {aiSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                </Button>
              </div>
              {clipResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{clipResults.length} results</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {clipResults.map(({ file, score }) => (
                      <div key={file.id} className="relative cursor-pointer group" onClick={() => setPlayingFile(file)}>
                        <div className="aspect-video rounded-md overflow-hidden bg-muted">
                          {file.has_thumbnail ? (
                            <img src={api.thumbnailUrl(file.id)} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" alt={file.filename} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Film className="h-6 w-6 text-muted-foreground/40" /></div>
                          )}
                        </div>
                        <div className="absolute top-1 right-1 text-[10px] bg-black/70 text-white rounded px-1">{Math.round(score * 100)}%</div>
                        <p className="text-xs truncate mt-1 text-muted-foreground">{file.filename}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {aiTab === "nudenet" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Filter videos by detected content. Requires AI scan.</p>
              <div className="space-y-2">
                {NUDENET_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">{group.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.labels.map((label) => (
                        <button
                          key={label}
                          onClick={() => toggleLabel(label)}
                          className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                            checkedLabels.has(label)
                              ? "bg-primary/10 border-primary text-primary"
                              : "border-border text-muted-foreground hover:border-foreground/40"
                          }`}
                        >
                          {label.replace(/_/g, " ")}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Min confidence: {Math.round(detectionConfidence * 100)}%</label>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={detectionConfidence}
                  onChange={(e) => setDetectionConfidence(Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
              </div>
              <Button size="sm" onClick={runDetectionFilter} disabled={aiSearching || checkedLabels.size === 0}>
                {aiSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Filter videos
              </Button>
              {detectionResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{detectionResults.length} videos matched</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {detectionResults.map((file) => (
                      <div key={file.id} className="relative cursor-pointer group" onClick={() => setPlayingFile(file)}>
                        <div className="aspect-video rounded-md overflow-hidden bg-muted">
                          {file.has_thumbnail ? (
                            <img src={api.thumbnailUrl(file.id)} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" alt={file.filename} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Film className="h-6 w-6 text-muted-foreground/40" /></div>
                          )}
                        </div>
                        <p className="text-xs truncate mt-1 text-muted-foreground">{file.filename}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {selectedLibrary ? (
        <LibraryBrowser
          library={selectedLibrary}
          statusFilter={selectedStatus}
          sortBy={sortBy}
          sortDir={sortDir}
          viewMode={viewMode}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggle={toggleId}
          onSelectAll={selectAll}
          onPlay={setPlayingFile}
        />
      ) : (
        <FlatView
          statusFilter={selectedStatus}
          sortBy={sortBy}
          sortDir={sortDir}
          viewMode={viewMode}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggle={toggleId}
          onSelectAll={selectAll}
          onPlay={setPlayingFile}
        />
      )}

      {playingFile && <VideoPlayerModal file={playingFile} onClose={() => setPlayingFile(null)} />}
    </div>
  );
}
