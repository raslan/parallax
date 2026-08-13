import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Wrench, X, Loader2, Check, LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown, Search,
  RotateCw, RotateCcw, RefreshCw,
} from "lucide-react";
import { toolboxApi, api, VideoFile, Library } from "@/lib/api";
import { FileGridCard, FileListRow, ColHeader, applySortDir, SortDir } from "@/components/FileSelectGrid";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatSize, formatDuration } from "@/lib/format";

type SortKey = "filename" | "codec" | "duration" | "size";
type RotateDeg = 90 | 180 | 270;
type AudioChannel = "auto" | "left" | "right";

function sortFiles(files: VideoFile[], key: SortKey, dir: SortDir): VideoFile[] {
  const sorted = [...files].sort((a, b) => {
    let va: number | string, vb: number | string;
    switch (key) {
      case "filename": va = a.filename.toLowerCase(); vb = b.filename.toLowerCase(); break;
      case "codec":    va = a.codec_name ?? ""; vb = b.codec_name ?? ""; break;
      case "duration": va = a.duration ?? 0; vb = b.duration ?? 0; break;
      case "size":     va = a.size; vb = b.size; break;
    }
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  return applySortDir(sorted, dir);
}

export function Toolbox() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [files, setFiles] = useState<VideoFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fix settings
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [audioChannel, setAudioChannel] = useState<AudioChannel | null>(null);
  const [rotateDeg, setRotateDeg] = useState<RotateDeg | null>(null);
  const [normalize, setNormalize] = useState(false);
  const [faststart, setFaststart] = useState(false);
  const [syncOffsetMs, setSyncOffsetMs] = useState(0);
  const [keepOriginal, setKeepOriginal] = useState(true);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortKey, setSortKey] = useState<SortKey>("filename");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [playingFile, setPlayingFile] = useState<VideoFile | null>(null);

  const [search, setSearch] = useState("");
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobCurrentFile, setJobCurrentFile] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.getLibraries().then((libs) => {
      setLibraries(libs);
      if (libs.length > 0) setLibraryId(libs[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (libraryId == null) return;
    setLoadingFiles(true);
    setLoadError(null);
    setFiles(null);
    setSelected(new Set());
    toolboxApi.libraryFiles(libraryId).then((f) => {
      setFiles(f);
      setSelected(new Set());
    }).catch((e: unknown) => {
      setLoadError(e instanceof Error ? e.message : String(e));
    }).finally(() => setLoadingFiles(false));
  }, [libraryId]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const displayFiles = useMemo(
    () => files ? sortFiles(files, sortKey, sortDir) : null,
    [files, sortKey, sortDir]
  );
  const filteredFiles = useMemo(
    () => displayFiles
      ? (search.trim() ? displayFiles.filter((f) => f.filename.toLowerCase().includes(search.toLowerCase())) : displayFiles)
      : null,
    [displayFiles, search]
  );

  const toggleFile = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => filteredFiles && setSelected(new Set(filteredFiles.map((f) => f.id)));
  const selectNone = () => setSelected(new Set());

  const selectedFiles = useMemo(
    () => (filteredFiles ?? []).filter((f) => selected.has(f.id)),
    [filteredFiles, selected]
  );

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const refreshFiles = useCallback((libId: number) => {
    toolboxApi.libraryFiles(libId).then((f) => {
      setFiles(f);
      setSelected((prev) => new Set(f.filter((x) => prev.has(x.id)).map((x) => x.id)));
    }).catch(() => {});
  }, []);

  const pollJob = useCallback((id: number, libId: number | null) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const job = await api.getJob(id);
        setJobProgress(job.progress ?? 0);
        setJobCurrentFile(job.current_file ?? null);
        setJobStatus(job.status);
        setJobError(job.error ?? null);
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          stopPoll();
          if (job.status === "completed" && libId != null) refreshFiles(libId);
        }
      } catch { stopPoll(); }
    }, 1500);
  }, [stopPoll, refreshFiles]);

  useEffect(() => {
    api.getJobs(100).then((jobs) => {
      const active = jobs.find(
        (j) => j.type === "toolbox_fix" && (j.status === "running" || j.status === "pending")
      );
      if (!active) return;
      setJobId(active.id);
      setJobStatus(active.status);
      setJobProgress(active.progress ?? 0);
      setJobCurrentFile(active.current_file ?? null);
      setJobError(active.error ?? null);
      pollJob(active.id, active.library_id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasFix = trimStart > 0 || trimEnd > 0 || audioChannel != null || rotateDeg != null
    || normalize || faststart || syncOffsetMs !== 0;

  const handleStart = async () => {
    if (selectedFiles.length === 0 || !hasFix || starting) return;
    setStarting(true);
    setJobError(null);
    try {
      const { job_id } = await toolboxApi.start({
        file_ids: selectedFiles.map((f) => f.id),
        trim_start: trimStart,
        trim_end: trimEnd,
        audio_channel: audioChannel,
        rotate_deg: rotateDeg,
        normalize,
        faststart,
        sync_offset_ms: syncOffsetMs !== 0 ? syncOffsetMs : null,
        keep_original: keepOriginal,
      });
      setJobId(job_id);
      setJobStatus("pending");
      setJobProgress(0);
      setJobCurrentFile(null);
      pollJob(job_id, libraryId);
    } catch (e: unknown) {
      setJobError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (jobId == null) return;
    try { await api.cancelJob(jobId); } catch {}
  };

  const isRunning = jobStatus === "running" || jobStatus === "pending";
  const isDone = jobStatus === "completed" || jobStatus === "failed" || jobStatus === "cancelled";

  return (
    <div className="p-8 space-y-6">
      {playingFile && (
        <VideoPlayerModal
          file={playingFile}
          streamUrl={api.streamUrl(playingFile.id)}
          subtitleTracksUrl={api.subtitleTracksUrl(playingFile.id)}
          onClose={() => setPlayingFile(null)}
        />
      )}

      <div>
        <SectionHeader className="mb-1.5">Videos</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Toolbox</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Trim, fix audio, rotate, normalize, and other lossless-where-possible per-file fixes. Stack as many as you need — one job, one pass. Originals saved to{" "}
          <code className="font-mono text-xs">_originals/</code> when enabled.
        </p>
      </div>

      {/* Settings panel */}
      <div className="rounded-lg border border-border/50 bg-muted/10 divide-y divide-border/40">

        <div className="px-5 py-4 flex items-center gap-8">
          <div className="w-40 shrink-0">
            <p className="text-xs font-medium text-foreground">Library</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Source of files to fix</p>
          </div>
          <select
            value={libraryId ?? ""}
            onChange={(e) => setLibraryId(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-64"
          >
            {libraries.map((l) => (
              <option key={l.id} value={l.id}>{l.name || l.path}</option>
            ))}
          </select>
        </div>

        {/* Trim */}
        <div className="px-5 py-4 flex items-start gap-8">
          <div className="w-40 shrink-0">
            <p className="text-xs font-medium text-foreground">Trim</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Cut seconds off the start and/or end. Stream-copied — instant.</p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              Start
              <input
                type="number" min={0} step={0.5} value={trimStart}
                onChange={(e) => setTrimStart(Math.max(0, Number(e.target.value)))}
                className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              /> sec
            </label>
            <label className="flex items-center gap-2 text-sm">
              End
              <input
                type="number" min={0} step={0.5} value={trimEnd}
                onChange={(e) => setTrimEnd(Math.max(0, Number(e.target.value)))}
                className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              /> sec
            </label>
          </div>
        </div>

        {/* Audio channel */}
        <div className="px-5 py-4 flex items-start gap-8">
          <div className="w-40 shrink-0">
            <p className="text-xs font-medium text-foreground">Audio Channel</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Fix one-ear audio by copying one channel to both.</p>
          </div>
          <div className="flex gap-2">
            {(["off", "auto", "left", "right"] as const).map((opt) => {
              const value = opt === "off" ? null : opt;
              const active = audioChannel === value;
              return (
                <button
                  key={opt}
                  onClick={() => setAudioChannel(value)}
                  className={cn(
                    "h-9 px-3 rounded-md border text-sm capitalize transition-colors",
                    active ? "border-primary/60 bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground"
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rotate */}
        <div className="px-5 py-4 flex items-start gap-8">
          <div className="w-40 shrink-0">
            <p className="text-xs font-medium text-foreground">Rotate</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Actually rotates pixels — forces a re-encode (near-lossless CRF 18).</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setRotateDeg(rotateDeg === 90 ? null : 90)}
              className={cn("h-9 px-3 rounded-md border text-sm flex items-center gap-1.5 transition-colors",
                rotateDeg === 90 ? "border-primary/60 bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground")}
            >
              <RotateCw className="h-3.5 w-3.5" /> 90° CW
            </button>
            <button
              onClick={() => setRotateDeg(rotateDeg === 270 ? null : 270)}
              className={cn("h-9 px-3 rounded-md border text-sm flex items-center gap-1.5 transition-colors",
                rotateDeg === 270 ? "border-primary/60 bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground")}
            >
              <RotateCcw className="h-3.5 w-3.5" /> 90° CCW
            </button>
            <button
              onClick={() => setRotateDeg(rotateDeg === 180 ? null : 180)}
              className={cn("h-9 px-3 rounded-md border text-sm flex items-center gap-1.5 transition-colors",
                rotateDeg === 180 ? "border-primary/60 bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground")}
            >
              <RefreshCw className="h-3.5 w-3.5" /> 180°
            </button>
          </div>
        </div>

        {/* Normalize + Faststart */}
        <div className="px-5 py-4 grid grid-cols-2 gap-0 divide-x divide-border/40">
          <div className="flex items-start gap-8 pr-8">
            <div className="w-40 shrink-0">
              <p className="text-xs font-medium text-foreground">Normalize Volume</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Even out loudness (EBU R128, single-pass).</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="accent-primary h-4 w-4" />
              <span className="text-sm text-foreground">Enable</span>
            </label>
          </div>
          <div className="flex items-start gap-8 pl-8">
            <div className="w-40 shrink-0">
              <p className="text-xs font-medium text-foreground">Faststart</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Move moov atom to front — fixes slow-to-seek mp4/m4v/mov.</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={faststart} onChange={(e) => setFaststart(e.target.checked)} className="accent-primary h-4 w-4" />
              <span className="text-sm text-foreground">Enable</span>
            </label>
          </div>
        </div>

        {/* Sync offset */}
        <div className="px-5 py-4 flex items-start gap-8">
          <div className="w-40 shrink-0">
            <p className="text-xs font-medium text-foreground">A/V Sync Offset</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Shift audio relative to video. Positive delays audio, negative advances it.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="number" step={10} value={syncOffsetMs}
              onChange={(e) => setSyncOffsetMs(Number(e.target.value))}
              className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            /> ms
          </label>
        </div>

        {/* Output */}
        <div className="px-5 py-4 flex items-center gap-8">
          <div className="w-40 shrink-0">
            <p className="text-xs font-medium text-foreground">Output</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">What happens to the original file</p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.target.checked)}
              className="accent-primary h-4 w-4 mt-0.5"
            />
            <div>
              <p className="text-sm text-foreground group-hover:text-foreground/90 transition-colors">Keep originals</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Moves source file to <code className="font-mono">_originals/</code> before replacing.</p>
            </div>
          </label>
        </div>
      </div>

      {/* Job progress */}
      {(isRunning || isDone) && jobId != null && (
        <div className={cn(
          "rounded-lg border px-4 py-3 space-y-2 max-w-2xl",
          isDone && jobStatus === "completed" ? "border-green-500/30 bg-green-500/5" :
          isDone ? "border-red-500/30 bg-red-500/5" : "border-primary/30 bg-primary/5"
        )}>
          <div className="flex items-center gap-3">
            {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
            <span className="text-sm font-medium flex-1">
              {jobStatus === "completed" ? "Fix complete" :
               jobStatus === "cancelled" ? "Cancelled" :
               jobStatus === "failed" ? "Fix failed" :
               jobCurrentFile ? `Fixing: ${jobCurrentFile}` : "Starting…"}
            </span>
            {isRunning && (
              <Button size="sm" variant="ghost" onClick={handleCancel} className="h-7 px-2 text-muted-foreground">
                <X className="h-3.5 w-3.5 mr-1" /> Cancel
              </Button>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${jobProgress}%` }} />
          </div>
          {jobError && <p className="text-xs text-red-400">{jobError}</p>}
        </div>
      )}

      {loadingFiles && (
        <div className="flex items-center gap-3 text-muted-foreground/60 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading library files…
        </div>
      )}
      {loadError && <p className="text-sm text-red-400">{loadError}</p>}

      {filteredFiles && !loadingFiles && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground">
              {filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""}
            </span>
            <button onClick={selectAll} className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors underline underline-offset-2">
              All
            </button>
            <button onClick={selectNone} className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors underline underline-offset-2">
              None
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search files…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 pr-3 rounded-md border border-input bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-ring w-48"
              />
            </div>
            <div className="flex-1" />

            <div className="flex border border-border rounded-md overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={cn("h-8 w-8 flex items-center justify-center transition-colors", viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn("h-8 w-8 flex items-center justify-center transition-colors", viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50")}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>

            <Button onClick={handleStart} disabled={selected.size === 0 || !hasFix || isRunning || starting} title={!hasFix ? "Pick at least one fix" : undefined}>
              {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
              Fix {selected.size > 0 ? `${selected.size} file${selected.size !== 1 ? "s" : ""}` : ""}
            </Button>
          </div>

          {filteredFiles.length === 0 ? (
            <div className="flex items-center justify-center py-16 border border-dashed rounded-lg text-muted-foreground/40 text-sm">
              {search.trim() ? "No files match your search" : "No files in this library"}
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filteredFiles.map((f) => (
                <FileGridCard
                  key={f.id}
                  file={f}
                  selected={selected.has(f.id)}
                  onToggle={() => toggleFile(f.id)}
                  onPlay={() => setPlayingFile(f)}
                />
              ))}
            </div>
          ) : (
            <div className="border border-border/50 rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/30 bg-muted/20">
                <span className="w-4 shrink-0" />
                <ColHeader label="Filename" sortKey="filename" current={sortKey} dir={sortDir} onSort={handleSort} className="flex-1" />
                <ColHeader label="Codec" sortKey="codec" current={sortKey} dir={sortDir} onSort={handleSort} className="w-14 justify-end shrink-0" />
                <ColHeader label="Duration" sortKey="duration" current={sortKey} dir={sortDir} onSort={handleSort} className="w-14 justify-end shrink-0" />
                <ColHeader label="Size" sortKey="size" current={sortKey} dir={sortDir} onSort={handleSort} className="w-16 justify-end shrink-0" />
                <span className="w-6 shrink-0" />
              </div>
              {filteredFiles.map((f) => (
                <FileListRow
                  key={f.id}
                  file={f}
                  selected={selected.has(f.id)}
                  onToggle={() => toggleFile(f.id)}
                  onPlay={() => setPlayingFile(f)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {libraries.length === 0 && !loadingFiles && (
        <div className="flex items-center justify-center py-16 border border-dashed rounded-lg text-muted-foreground/40 text-sm">
          No video libraries yet — add one on the Libraries page
        </div>
      )}
    </div>
  );
}
