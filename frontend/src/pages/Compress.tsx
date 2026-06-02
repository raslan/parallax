import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Minimize2, Zap, X, Loader2, ImageOff, Check, Play,
  CheckSquare, Square, TrendingDown, LayoutGrid, List,
  ArrowUpDown, ArrowUp, ArrowDown, Search,
} from "lucide-react";
import { compressApi, CompressCodec, VideoFile, Library, api } from "@/lib/api";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatSize, formatDuration } from "@/lib/format";

// ── Radio toggle group ────────────────────────────────────────────────────────

function RadioToggle<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; hint?: string }[];
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex items-start gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors flex-1 min-w-[120px]",
              active
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground"
            )}
          >
            <span className={cn(
              "mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 transition-colors",
              active ? "border-primary bg-primary" : "border-muted-foreground/40"
            )} />
            <span>
              <span className="font-medium block">{opt.label}</span>
              {opt.hint && <span className="text-[11px] text-muted-foreground/70 block mt-0.5">{opt.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Estimation ────────────────────────────────────────────────────────────────

const SRC_EFF: Record<string, number> = {
  h264: 1.0, hevc: 0.55, av1: 0.45, vp9: 0.55, vp8: 0.85,
  mpeg2video: 1.5, mpeg4: 1.2, wmv2: 1.4, wmv3: 1.2, msmpeg4v3: 1.3, flv1: 1.3,
};
const TGT_EFF: Record<string, number> = { h264: 1.0, hevc: 0.55, av1: 0.45 };
const DEFAULT_CRF: Record<string, number> = { h264: 23, hevc: 28, av1: 35 };
// Slower preset = encoder spends more time finding efficient compression at same CRF
const SPEED_FACTOR: Record<string, number> = { slow: 0.92, medium: 1.0, fast: 1.08 };

function estimateSize(f: VideoFile, codec: string, crf: number, speed = "medium"): number {
  if (!f.size) return 0;
  const srcEff = SRC_EFF[f.codec_name?.toLowerCase() ?? "h264"] ?? 1.0;
  const tgtEff = TGT_EFF[codec] ?? 1.0;
  const crfDelta = crf - (DEFAULT_CRF[codec] ?? 23);
  const speedF = SPEED_FACTOR[speed] ?? 1.0;
  return Math.round(f.size * Math.max((tgtEff / srcEff) * Math.pow(2, -crfDelta / 6) * speedF, 0.05));
}

function savingsPct(f: VideoFile, codec: string, crf: number, speed = "medium"): number {
  const est = estimateSize(f, codec, crf, speed);
  return f.size > 0 ? Math.round((1 - est / f.size) * 100) : 0;
}

// ── CRF quality tiers ─────────────────────────────────────────────────────────

type QualityTier = { label: string; color: string };

const CRF_TIERS: Record<string, Array<{ max: number } & QualityTier>> = {
  h264: [
    { max: 17, label: "Visually lossless", color: "text-emerald-400" },
    { max: 23, label: "High quality",      color: "text-green-400" },
    { max: 28, label: "Good quality",      color: "text-yellow-400" },
    { max: 35, label: "Noticeable loss",   color: "text-orange-400" },
    { max: 51, label: "Severe degradation", color: "text-red-400" },
  ],
  hevc: [
    { max: 20, label: "Visually lossless", color: "text-emerald-400" },
    { max: 28, label: "High quality",      color: "text-green-400" },
    { max: 35, label: "Good quality",      color: "text-yellow-400" },
    { max: 42, label: "Noticeable loss",   color: "text-orange-400" },
    { max: 51, label: "Severe degradation", color: "text-red-400" },
  ],
  av1: [
    { max: 25, label: "Visually lossless", color: "text-emerald-400" },
    { max: 35, label: "High quality",      color: "text-green-400" },
    { max: 45, label: "Good quality",      color: "text-yellow-400" },
    { max: 55, label: "Noticeable loss",   color: "text-orange-400" },
    { max: 63, label: "Severe degradation", color: "text-red-400" },
  ],
};

function getCrfTier(codec: string, crf: number): QualityTier {
  const tiers = CRF_TIERS[codec] ?? CRF_TIERS.h264;
  return tiers.find((t) => crf <= t.max) ?? tiers[tiers.length - 1];
}

function getCrfWarnThreshold(codec: string): number {
  // CRF where noticeable loss begins
  const tiers = CRF_TIERS[codec] ?? CRF_TIERS.h264;
  const warn = tiers.find((t) => t.label === "Noticeable loss");
  return warn ? tiers[tiers.indexOf(warn) - 1].max + 1 : 999;
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = "filename" | "codec" | "duration" | "size" | "savings";
type SortDir = "asc" | "desc";

function applySortDir<T>(arr: T[], dir: SortDir): T[] {
  return dir === "desc" ? [...arr].reverse() : arr;
}

function sortFiles(files: VideoFile[], key: SortKey, dir: SortDir, codec: string, crf: number, speed: string): VideoFile[] {
  const sorted = [...files].sort((a, b) => {
    let va: number | string, vb: number | string;
    switch (key) {
      case "filename": va = a.filename.toLowerCase(); vb = b.filename.toLowerCase(); break;
      case "codec":    va = a.codec_name ?? ""; vb = b.codec_name ?? ""; break;
      case "duration": va = a.duration ?? 0; vb = b.duration ?? 0; break;
      case "size":     va = a.size; vb = b.size; break;
      case "savings":  va = savingsPct(a, codec, crf, speed); vb = savingsPct(b, codec, crf, speed); break;
    }
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  return applySortDir(sorted, dir);
}

// ── Grid card — exact Files.tsx pattern ───────────────────────────────────────

function GridCard({
  file, selected, onToggle, onPlay, codec, crf, speed,
}: {
  file: VideoFile; selected: boolean; onToggle: () => void; onPlay: () => void;
  codec: string; crf: number; speed: string;
}) {
  const [imgError, setImgError] = useState(false);
  const pct = savingsPct(file, codec, crf, speed);
  const est = estimateSize(file, codec, crf, speed);
  const growing = est > file.size;

  return (
    <Card
      className={cn(
        "overflow-hidden cursor-pointer group transition-shadow hover:ring-1",
        selected ? "ring-2 ring-primary" : "hover:ring-primary"
      )}
      onClick={onToggle}
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

        {/* Checkbox top-left — always visible */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={cn(
            "absolute top-1.5 left-1.5 z-10 h-4 w-4 rounded border-2 flex items-center justify-center transition-colors",
            selected ? "bg-primary border-primary" : "bg-black/50 border-white/70"
          )}
        >
          {selected && <Check className="h-2.5 w-2.5 text-white" />}
        </button>

        {/* Savings badge top-right */}
        <div className="absolute top-1.5 right-1.5">
          <span className={cn(
            "text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/60 font-mono",
            growing ? "text-red-400" : pct > 0 ? "text-green-400" : "text-muted-foreground/60"
          )}>
            {growing ? `+${Math.abs(pct)}%` : pct > 0 ? `-${pct}%` : "—"}
          </span>
        </div>

        {/* Play button on hover — bottom-right */}
        <div className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(); }}
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

// ── Sort column header ────────────────────────────────────────────────────────

function ColHeader({ label, sortKey, current, dir, onSort, className }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir;
  onSort: (k: SortKey) => void; className?: string;
}) {
  const active = current === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={cn("flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/40 hover:text-muted-foreground transition-colors", className)}
    >
      {label}
      {active
        ? dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        : <ArrowUpDown className="h-3 w-3 opacity-30" />}
    </button>
  );
}

// ── List row ──────────────────────────────────────────────────────────────────

function ListRow({ file, selected, onToggle, onPlay, codec, crf, speed }: {
  file: VideoFile; selected: boolean; onToggle: () => void; onPlay: () => void;
  codec: string; crf: number; speed: string;
}) {
  const est = estimateSize(file, codec, crf, speed);
  const pct = savingsPct(file, codec, crf, speed);
  const growing = est > file.size;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer select-none group",
        selected && "bg-primary/5"
      )}
      onClick={onToggle}
    >
      <span className="shrink-0">
        {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground" />}
      </span>
      <span className="flex-1 text-sm font-mono truncate text-muted-foreground min-w-0" title={file.path}>
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
      <span className={cn("text-xs shrink-0 w-16 text-right font-mono", growing ? "text-red-400" : "text-muted-foreground/70")}>
        {formatSize(est)}
      </span>
      <span className={cn("text-xs shrink-0 w-14 text-right font-semibold", growing ? "text-red-400" : pct > 0 ? "text-green-400" : "text-muted-foreground/50")}>
        {growing ? `+${Math.abs(pct)}%` : pct > 0 ? `-${pct}%` : "—"}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onPlay(); }}
        title="Preview"
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-foreground text-muted-foreground/50"
      >
        <Play className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Compress() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [files, setFiles] = useState<VideoFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [codecs, setCodecs] = useState<CompressCodec[]>([]);
  const [codec, setCodec] = useState("hevc");
  const [crf, setCrf] = useState(28);
  const [speed, setSpeed] = useState("medium");
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
    compressApi.codecs().then((c) => {
      setCodecs(c);
      const hevc = c.find((x) => x.id === "hevc");
      const first = hevc ?? c[0];
      if (first) { setCodec(first.id); setCrf(first.default_crf); }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (libraryId == null) return;
    setLoadingFiles(true);
    setLoadError(null);
    setFiles(null);
    setSelected(new Set());
    compressApi.libraryFiles(libraryId).then((f) => {
      setFiles(f);
      setSelected(new Set());
    }).catch((e: unknown) => {
      setLoadError(e instanceof Error ? e.message : String(e));
    }).finally(() => setLoadingFiles(false));
  }, [libraryId]);

  const handleCodecChange = (id: string) => {
    setCodec(id);
    const def = codecs.find((c) => c.id === id)?.default_crf ?? 23;
    setCrf(def);
  };

  const crfRange = useMemo(() => {
    const c = codecs.find((x) => x.id === codec);
    return c ? { min: c.crf_min, max: c.crf_max } : { min: 0, max: 51 };
  }, [codec, codecs]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const displayFiles = useMemo(
    () => files ? sortFiles(files, sortKey, sortDir, codec, crf, speed) : null,
    [files, sortKey, sortDir, codec, crf, speed]
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
  const selectCandidates = () =>
    filteredFiles && setSelected(new Set(
      filteredFiles.filter((f) => f.codec_name?.toLowerCase() !== codec).map((f) => f.id)
    ));
  const selectCorrupt = () =>
    filteredFiles && setSelected(new Set(
      filteredFiles.filter((f) => f.status === "corrupt").map((f) => f.id)
    ));

  const selectedFiles = useMemo(
    () => (filteredFiles ?? []).filter((f) => selected.has(f.id)),
    [filteredFiles, selected]
  );

  // Selection stats
  const totalSourceSize = selectedFiles.reduce((s, f) => s + f.size, 0);
  const totalEstSize = selectedFiles.reduce((s, f) => s + estimateSize(f, codec, crf, speed), 0);
  const totalSavingsPct = totalSourceSize > 0
    ? Math.round(((totalSourceSize - totalEstSize) / totalSourceSize) * 100)
    : 0;

  // Library-wide stats (all loaded files, not just selected)
  const libraryTotalSize = useMemo(
    () => (files ?? []).reduce((s, f) => s + f.size, 0),
    [files]
  );
  const libraryEstSize = useMemo(
    () => (files ?? []).reduce((s, f) => s + estimateSize(f, codec, crf, speed), 0),
    [files, codec, crf, speed]
  );
  const librarySavingsPct = libraryTotalSize > 0
    ? Math.round(((libraryTotalSize - libraryEstSize) / libraryTotalSize) * 100)
    : 0;

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const refreshFiles = useCallback((libId: number) => {
    compressApi.libraryFiles(libId).then((f) => {
      setFiles(f);
      // Preserve existing selection where possible; newly compressed files stay selected
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

  // Resume polling any active compress job on mount
  useEffect(() => {
    api.getJobs(100).then((jobs) => {
      const active = jobs.find(
        (j) => j.type === "compress" && (j.status === "running" || j.status === "pending")
      );
      if (!active) return;
      setJobId(active.id);
      setJobStatus(active.status);
      setJobProgress(active.progress ?? 0);
      setJobCurrentFile(active.current_file ?? null);
      setJobError(active.error ?? null);
      // libraryId may not be set yet — capture via closure at poll time
      pollJob(active.id, active.library_id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async () => {
    if (selectedFiles.length === 0 || starting) return;
    setStarting(true);
    setJobError(null);
    try {
      const { job_id } = await compressApi.start({
        file_ids: selectedFiles.map((f) => f.id),
        codec, crf, speed, keep_original: keepOriginal,
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
  const selectedCodec = codecs.find((c) => c.id === codec);

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

      {/* Header */}
      <div>
        <SectionHeader className="mb-1.5">Videos</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Compress</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Re-encode library files with modern codecs to reduce storage. Originals saved to{" "}
          <code className="font-mono text-xs">_originals/</code> when enabled.
        </p>
      </div>

      {/* Settings panel */}
      <div className="rounded-lg border border-border/50 bg-muted/10 divide-y divide-border/40">

        {/* Row 1: Library */}
        <div className="px-5 py-4 flex items-center gap-8">
          <div className="w-40 shrink-0">
            <p className="text-xs font-medium text-foreground">Library</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Source of files to compress</p>
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

        {/* Row 2: Codec + Speed side by side */}
        <div className="px-5 py-4 grid grid-cols-2 gap-0 divide-x divide-border/40">
          <div className="flex items-start gap-8 pr-8">
            <div className="w-40 shrink-0">
              <p className="text-xs font-medium text-foreground">Target Codec</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Output video format</p>
              {selectedCodec && (
                <p className="text-[10px] text-muted-foreground/40 font-mono mt-1">via {selectedCodec.encoder}</p>
              )}
            </div>
            <div className="flex-1">
              <RadioToggle
                value={codec}
                onChange={handleCodecChange}
                options={codecs.map((c) => ({ id: c.id, label: c.label, hint: c.description }))}
              />
            </div>
          </div>

          <div className="flex items-start gap-8 pl-8">
            <div className="w-40 shrink-0">
              <p className="text-xs font-medium text-foreground">Encoding Speed</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Slower finds better compression at same CRF — affects size by ~8%</p>
            </div>
            <div className="flex-1">
              <RadioToggle
                value={speed}
                onChange={setSpeed}
                options={[
                  { id: "slow",   label: "Slow",   hint: "Best compression ratio" },
                  { id: "medium", label: "Medium",  hint: "Balanced" },
                  { id: "fast",   label: "Fast",    hint: "Quickest encode" },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Row 3: CRF slider — full width */}
        <div className="px-5 py-4 flex items-start gap-8">
          <div className="w-40 shrink-0">
            <p className="text-xs font-medium text-foreground">Quality (CRF)</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Lower = better quality, larger file. Each +6 roughly halves the bitrate.</p>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-mono font-light tabular-nums text-foreground">{crf}</span>
              {(() => { const tier = getCrfTier(codec, crf); return <span className={cn("text-sm font-medium", tier.color)}>({tier.label})</span>; })()}
            </div>
            <input
              type="range"
              min={crfRange.min}
              max={crfRange.max}
              step={1}
              value={crf}
              onChange={(e) => setCrf(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{crfRange.min} — lossless</span>
              <span>{crfRange.max} — smallest</span>
            </div>
          </div>
        </div>

        {/* Row 4: Output options */}
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
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Moves source file to <code className="font-mono">_originals/</code> before replacing. Lets you restore or free space later.</p>
            </div>
          </label>
        </div>

      </div>

      {/* Library stats */}
      {files && (
        <div className="grid grid-cols-4 gap-4">
          {[
            {
              label: "Library",
              value: formatSize(libraryTotalSize),
              sub: `${files.length} file${files.length !== 1 ? "s" : ""}`,
              accent: false,
            },
            {
              label: "Selected",
              value: formatSize(totalSourceSize),
              sub: `${selected.size} file${selected.size !== 1 ? "s" : ""}`,
              accent: false,
            },
            {
              label: "Estimated output",
              value: selected.size > 0 ? formatSize(totalEstSize) : formatSize(libraryEstSize),
              sub: selected.size > 0 ? "for selection" : "if all selected",
              accent: false,
            },
            (() => {
              const useSelection = selected.size > 0;
              const src = useSelection ? totalSourceSize : libraryTotalSize;
              const est = useSelection ? totalEstSize : libraryEstSize;
              const diff = src - est;
              const pct = useSelection ? totalSavingsPct : librarySavingsPct;
              const grows = diff < 0;
              return {
                label: "Estimated savings",
                value: grows ? `+${formatSize(Math.abs(diff))}` : `−${formatSize(diff)}`,
                sub: grows
                  ? `Files would grow ${Math.abs(pct)}% — try a higher CRF`
                  : `${pct}% reduction · est. ±20%`,
                accent: !grows,
                warn: grows,
              };
            })(),
          ].map(({ label, value, sub, accent, warn }: { label: string; value: string; sub: string; accent?: boolean; warn?: boolean }) => (
            <div key={label} className={cn("rounded-lg border bg-muted/10 px-5 py-4", warn ? "border-orange-500/30" : "border-border/50")}>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
              <p className={cn("text-2xl font-light tabular-nums mt-1", warn ? "text-orange-400" : accent ? "text-green-400" : "text-foreground")}>{value}</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      )}

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
              {jobStatus === "completed" ? "Compression complete" :
               jobStatus === "cancelled" ? "Cancelled" :
               jobStatus === "failed" ? "Compression failed" :
               jobCurrentFile ? `Compressing: ${jobCurrentFile}` : "Starting…"}
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

      {/* Loading / error */}
      {loadingFiles && (
        <div className="flex items-center gap-3 text-muted-foreground/60 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading library files…
        </div>
      )}
      {loadError && <p className="text-sm text-red-400">{loadError}</p>}

      {/* File list */}
      {filteredFiles && !loadingFiles && (
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
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
            <span className="text-sm text-muted-foreground">
              {filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""}
            </span>
            <button onClick={selectAll} className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors underline underline-offset-2">
              All
            </button>
            <button onClick={selectNone} className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors underline underline-offset-2">
              None
            </button>
            <button onClick={selectCandidates} className="text-xs text-primary/70 hover:text-primary transition-colors underline underline-offset-2" title={`Select files not already ${selectedCodec?.label ?? codec}`}>
              Non-{selectedCodec?.label ?? codec.toUpperCase()}
            </button>
            <button onClick={selectCorrupt} className="text-xs text-destructive/70 hover:text-destructive transition-colors underline underline-offset-2" title="Select all corrupt files">
              Corrupt
            </button>
            <div className="flex-1" />

            {selected.size > 0 && (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground/70">
                  {formatSize(totalSourceSize)} → <span className="text-foreground">{formatSize(totalEstSize)}</span>
                </span>
                <Badge
                  variant="secondary"
                  className={cn("font-mono text-xs", totalSavingsPct > 0 ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10")}
                >
                  <TrendingDown className="h-3 w-3 mr-1" />
                  {totalSavingsPct > 0 ? `-${totalSavingsPct}%` : `+${Math.abs(totalSavingsPct)}%`}
                </Badge>
                <span className="text-xs text-muted-foreground/40">est. ±20%</span>
              </div>
            )}

            {/* View toggle */}
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

            <Button onClick={handleStart} disabled={selected.size === 0 || isRunning || starting}>
              {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
              Compress {selected.size > 0 ? `${selected.size} file${selected.size !== 1 ? "s" : ""}` : ""}
            </Button>
          </div>

          {filteredFiles.length === 0 ? (
            <div className="flex items-center justify-center py-16 border border-dashed rounded-lg text-muted-foreground/40 text-sm">
              {search.trim() ? "No files match your search" : "No files in this library"}
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filteredFiles.map((f) => (
                <GridCard
                  key={f.id}
                  file={f}
                  selected={selected.has(f.id)}
                  onToggle={() => toggleFile(f.id)}
                  onPlay={() => setPlayingFile(f)}
                  codec={codec}
                  crf={crf}
                  speed={speed}
                />
              ))}
            </div>
          ) : (
            <div className="border border-border/50 rounded-lg overflow-hidden">
              {/* Headers */}
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/30 bg-muted/20">
                <span className="w-4 shrink-0" />
                <ColHeader label="Filename" sortKey="filename" current={sortKey} dir={sortDir} onSort={handleSort} className="flex-1" />
                <ColHeader label="Codec" sortKey="codec" current={sortKey} dir={sortDir} onSort={handleSort} className="w-14 justify-end shrink-0" />
                <ColHeader label="Duration" sortKey="duration" current={sortKey} dir={sortDir} onSort={handleSort} className="w-14 justify-end shrink-0" />
                <ColHeader label="Current" sortKey="size" current={sortKey} dir={sortDir} onSort={handleSort} className="w-16 justify-end shrink-0" />
                <span className="w-16 text-right shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/40">Estimated</span>
                <ColHeader label="Savings" sortKey="savings" current={sortKey} dir={sortDir} onSort={handleSort} className="w-14 justify-end shrink-0" />
                <span className="w-6 shrink-0" />
              </div>
              {filteredFiles.map((f) => (
                <ListRow
                  key={f.id}
                  file={f}
                  selected={selected.has(f.id)}
                  onToggle={() => toggleFile(f.id)}
                  onPlay={() => setPlayingFile(f)}
                  codec={codec}
                  crf={crf}
                  speed={speed}
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
