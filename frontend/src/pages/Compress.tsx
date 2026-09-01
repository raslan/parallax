import { useState, useEffect, useCallback, useMemo } from "react";
import { Zap, X, Loader2, TrendingDown, LayoutGrid, List, Search } from "lucide-react";
import { compressApi, api } from "@/lib/api";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useSelection } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import type { CompressCodec } from "@/types/compress";
import type { VideoFile } from "@/types/file";
import type { Library } from "@/types/library";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatSize } from "@/lib/format";
import {
  FileGridCard,
  FileListRow,
  filterByFilename,
  ColHeader,
  applySortDir,
  SortDir,
} from "@/components/FileSelectGrid";
import { useLiveFiles } from "@/hooks/useLiveFiles";

// ── Radio toggle group ────────────────────────────────────────────────────────

function RadioToggle<T extends string>({
  value,
  onChange,
  options,
}: {
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
                : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 transition-colors",
                active ? "border-primary bg-primary" : "border-muted-foreground/40",
              )}
            />
            <span>
              <span className="font-medium block">{opt.label}</span>
              {opt.hint && (
                <span className="text-[11px] text-muted-foreground/70 block mt-0.5">
                  {opt.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Estimation ────────────────────────────────────────────────────────────────

const SRC_EFF: Record<string, number> = {
  h264: 1.0,
  hevc: 0.55,
  av1: 0.45,
  vp9: 0.55,
  vp8: 0.85,
  mpeg2video: 1.5,
  mpeg4: 1.2,
  wmv2: 1.4,
  wmv3: 1.2,
  msmpeg4v3: 1.3,
  flv1: 1.3,
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
  return Math.round(
    f.size * Math.max((tgtEff / srcEff) * Math.pow(2, -crfDelta / 6) * speedF, 0.05),
  );
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
    { max: 23, label: "High quality", color: "text-green-400" },
    { max: 28, label: "Good quality", color: "text-yellow-400" },
    { max: 35, label: "Noticeable loss", color: "text-orange-400" },
    { max: 51, label: "Severe degradation", color: "text-red-400" },
  ],
  hevc: [
    { max: 20, label: "Visually lossless", color: "text-emerald-400" },
    { max: 28, label: "High quality", color: "text-green-400" },
    { max: 35, label: "Good quality", color: "text-yellow-400" },
    { max: 42, label: "Noticeable loss", color: "text-orange-400" },
    { max: 51, label: "Severe degradation", color: "text-red-400" },
  ],
  av1: [
    { max: 25, label: "Visually lossless", color: "text-emerald-400" },
    { max: 35, label: "High quality", color: "text-green-400" },
    { max: 45, label: "Good quality", color: "text-yellow-400" },
    { max: 55, label: "Noticeable loss", color: "text-orange-400" },
    { max: 63, label: "Severe degradation", color: "text-red-400" },
  ],
};

function getCrfTier(codec: string, crf: number): QualityTier {
  const tiers = CRF_TIERS[codec] ?? CRF_TIERS.h264;
  return tiers.find((t) => crf <= t.max) ?? tiers[tiers.length - 1];
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = "filename" | "codec" | "duration" | "size" | "savings";

function sortFiles(
  files: VideoFile[],
  key: SortKey,
  dir: SortDir,
  codec: string,
  crf: number,
  speed: string,
): VideoFile[] {
  const sorted = [...files].sort((a, b) => {
    let va: number | string, vb: number | string;
    switch (key) {
      case "filename":
        va = a.filename.toLowerCase();
        vb = b.filename.toLowerCase();
        break;
      case "codec":
        va = a.codec_name ?? "";
        vb = b.codec_name ?? "";
        break;
      case "duration":
        va = a.duration ?? 0;
        vb = b.duration ?? 0;
        break;
      case "size":
        va = a.size;
        vb = b.size;
        break;
      case "savings":
        va = savingsPct(a, codec, crf, speed);
        vb = savingsPct(b, codec, crf, speed);
        break;
    }
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  return applySortDir(sorted, dir);
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

  const {
    selected,
    setSelected,
    toggle: toggleFile,
    selectAll: selectAllIds,
    selectNone,
  } = useSelection();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const { sortKey, sortDir, toggleSort: handleSort } = useSort<SortKey>("filename");
  const [playingFile, setPlayingFile] = useState<VideoFile | null>(null);

  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api
      .getLibraries()
      .then((libs) => {
        setLibraries(libs);
        if (libs.length > 0) setLibraryId(libs[0].id);
      })
      .catch(() => {});
    compressApi
      .codecs()
      .then((c) => {
        setCodecs(c);
        const hevc = c.find((x) => x.id === "hevc");
        const first = hevc ?? c[0];
        if (first) {
          setCodec(first.id);
          setCrf(first.default_crf);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (libraryId == null) return;
    // Initialize file loading state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingFiles(true);
    setLoadError(null);
    setFiles(null);
    setSelected(new Set());
    compressApi
      .libraryFiles(libraryId)
      .then((f) => {
        setFiles(f);
        setSelected(new Set());
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingFiles(false));
  }, [libraryId, setSelected]);

  const handleCodecChange = (id: string) => {
    setCodec(id);
    const def = codecs.find((c) => c.id === id)?.default_crf ?? 23;
    setCrf(def);
  };

  const crfRange = useMemo(() => {
    const c = codecs.find((x) => x.id === codec);
    return c ? { min: c.crf_min, max: c.crf_max } : { min: 0, max: 51 };
  }, [codec, codecs]);

  const displayFiles = useMemo(
    () => (files ? sortFiles(files, sortKey, sortDir, codec, crf, speed) : null),
    [files, sortKey, sortDir, codec, crf, speed],
  );
  const filteredFiles = useMemo(
    () => (displayFiles ? filterByFilename(displayFiles, search) : null),
    [displayFiles, search],
  );

  const selectAll = () => filteredFiles && selectAllIds(filteredFiles.map((f) => f.id));
  const selectCandidates = () =>
    filteredFiles &&
    setSelected(
      new Set(filteredFiles.filter((f) => f.codec_name?.toLowerCase() !== codec).map((f) => f.id)),
    );
  const selectCorrupt = () =>
    filteredFiles &&
    setSelected(new Set(filteredFiles.filter((f) => f.status === "corrupt").map((f) => f.id)));

  const selectedFiles = useMemo(
    () => (filteredFiles ?? []).filter((f) => selected.has(f.id)),
    [filteredFiles, selected],
  );

  // Selection stats
  const totalSourceSize = selectedFiles.reduce((s, f) => s + f.size, 0);
  const totalEstSize = selectedFiles.reduce((s, f) => s + estimateSize(f, codec, crf, speed), 0);
  const totalSavingsPct =
    totalSourceSize > 0
      ? Math.round(((totalSourceSize - totalEstSize) / totalSourceSize) * 100)
      : 0;

  // Library-wide stats (all loaded files, not just selected)
  const libraryTotalSize = useMemo(() => (files ?? []).reduce((s, f) => s + f.size, 0), [files]);
  const libraryEstSize = useMemo(
    () => (files ?? []).reduce((s, f) => s + estimateSize(f, codec, crf, speed), 0),
    [files, codec, crf, speed],
  );
  const librarySavingsPct =
    libraryTotalSize > 0
      ? Math.round(((libraryTotalSize - libraryEstSize) / libraryTotalSize) * 100)
      : 0;

  const refreshFiles = useCallback(
    (libId: number) => {
      compressApi
        .libraryFiles(libId)
        .then((f) => {
          setFiles(f);
          // Preserve existing selection where possible; newly compressed files stay selected
          setSelected((prev) => new Set(f.filter((x) => prev.has(x.id)).map((x) => x.id)));
        })
        .catch(() => {});
    },
    [setSelected],
  );

  useLiveFiles("video", libraryId, () => {
    if (libraryId != null) refreshFiles(libraryId);
  });

  const {
    jobId,
    status: jobStatus,
    progress: jobProgress,
    currentFile: jobCurrentFile,
    error: jobError,
    start: startJobPoll,
    resume: resumeJobPoll,
  } = useJobPoll({
    onTerminal: (job) => {
      if (job.status === "completed" && job.library_id != null) refreshFiles(job.library_id);
    },
  });

  // Resume polling any active compress job on mount
  useEffect(() => {
    api
      .getJobs(100)
      .then((jobs) => resumeJobPoll(jobs, (j) => j.type === "compress"))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [startError, setStartError] = useState<string | null>(null);

  const handleStart = async () => {
    if (selectedFiles.length === 0 || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const { job_id } = await compressApi.start({
        file_ids: selectedFiles.map((f) => f.id),
        codec,
        crf,
        speed,
        keep_original: keepOriginal,
      });
      startJobPoll(job_id);
    } catch (e: unknown) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (jobId == null) return;
    try {
      await api.cancelJob(jobId);
    } catch {
      // Ignore error when canceling job
    }
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
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              Source of files to compress
            </p>
          </div>
          <select
            value={libraryId ?? ""}
            onChange={(e) => setLibraryId(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring w-64"
          >
            {libraries.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || l.path}
              </option>
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
                <p className="text-[10px] text-muted-foreground/40 font-mono mt-1">
                  via {selectedCodec.encoder}
                </p>
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
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                Slower finds better compression at same CRF — affects size by ~8%
              </p>
            </div>
            <div className="flex-1">
              <RadioToggle
                value={speed}
                onChange={setSpeed}
                options={[
                  { id: "slow", label: "Slow", hint: "Best compression ratio" },
                  { id: "medium", label: "Medium", hint: "Balanced" },
                  { id: "fast", label: "Fast", hint: "Quickest encode" },
                ]}
              />
            </div>
          </div>
        </div>

        {/* Row 3: CRF slider — full width */}
        <div className="px-5 py-4 flex items-start gap-8">
          <div className="w-40 shrink-0">
            <p className="text-xs font-medium text-foreground">Quality (CRF)</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              Lower = better quality, larger file. Each +6 roughly halves the bitrate.
            </p>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-mono font-light tabular-nums text-foreground">
                {crf}
              </span>
              {(() => {
                const tier = getCrfTier(codec, crf);
                return (
                  <span className={cn("text-sm font-medium", tier.color)}>({tier.label})</span>
                );
              })()}
            </div>
            <input
              type="range"
              min={crfRange.min}
              max={crfRange.max}
              step={1}
              value={crf}
              onChange={(e) => setCrf(Number(e.target.value))}
              className="w-full accent-primary"
              data-testid="crf-slider"
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
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              What happens to the original file
            </p>
          </div>
          <label className="flex items-start gap-3 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.target.checked)}
              className="accent-primary h-4 w-4 mt-0.5"
            />
            <div>
              <p className="text-sm text-foreground group-hover:text-foreground/90 transition-colors">
                Keep originals
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                Moves source file to <code className="font-mono">_originals/</code> before
                replacing. Lets you restore or free space later.
              </p>
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
          ].map(
            ({
              label,
              value,
              sub,
              accent,
              warn,
            }: {
              label: string;
              value: string;
              sub: string;
              accent?: boolean;
              warn?: boolean;
            }) => (
              <div
                key={label}
                className={cn(
                  "rounded-lg border bg-muted/10 px-5 py-4",
                  warn ? "border-orange-500/30" : "border-border/50",
                )}
              >
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                  {label}
                </p>
                <p
                  className={cn(
                    "text-2xl font-light tabular-nums mt-1",
                    warn ? "text-orange-400" : accent ? "text-green-400" : "text-foreground",
                  )}
                >
                  {value}
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">{sub}</p>
              </div>
            ),
          )}
        </div>
      )}

      {/* Job progress */}
      {(isRunning || isDone) && jobId != null && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 space-y-2 max-w-2xl",
            isDone && jobStatus === "completed"
              ? "border-green-500/30 bg-green-500/5"
              : isDone
                ? "border-red-500/30 bg-red-500/5"
                : "border-primary/30 bg-primary/5",
          )}
        >
          <div className="flex items-center gap-3">
            {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />}
            <span className="text-sm font-medium flex-1">
              {jobStatus === "completed"
                ? "Compression complete"
                : jobStatus === "cancelled"
                  ? "Cancelled"
                  : jobStatus === "failed"
                    ? "Compression failed"
                    : jobCurrentFile
                      ? `Compressing: ${jobCurrentFile}`
                      : "Starting…"}
            </span>
            {isRunning && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancel}
                className="h-7 px-2 text-muted-foreground"
              >
                <X className="h-3.5 w-3.5 mr-1" /> Cancel
              </Button>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${jobProgress}%` }}
            />
          </div>
          {(jobError || startError) && (
            <p className="text-xs text-red-400">{jobError || startError}</p>
          )}
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
            <span className="text-sm text-muted-foreground">
              {filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={selectAll}
              className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors underline underline-offset-2"
            >
              All
            </button>
            <button
              onClick={selectNone}
              className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors underline underline-offset-2"
            >
              None
            </button>
            <button
              onClick={selectCandidates}
              className="text-xs text-primary/70 hover:text-primary transition-colors underline underline-offset-2"
              title={`Select files not already ${selectedCodec?.label ?? codec}`}
            >
              Non-{selectedCodec?.label ?? codec.toUpperCase()}
            </button>
            <button
              onClick={selectCorrupt}
              className="text-xs text-destructive/70 hover:text-destructive transition-colors underline underline-offset-2"
              title="Select all corrupt files"
            >
              Corrupt
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

            {selected.size > 0 && (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground/70">
                  {formatSize(totalSourceSize)} →{" "}
                  <span className="text-foreground">{formatSize(totalEstSize)}</span>
                </span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "font-mono text-xs",
                    totalSavingsPct > 0
                      ? "text-green-400 bg-green-400/10"
                      : "text-red-400 bg-red-400/10",
                  )}
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
                className={cn(
                  "h-8 w-8 flex items-center justify-center transition-colors",
                  viewMode === "grid"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "h-8 w-8 flex items-center justify-center transition-colors",
                  viewMode === "list"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>

            <Button onClick={handleStart} disabled={selected.size === 0 || isRunning || starting}>
              {starting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Compress{" "}
              {selected.size > 0 ? `${selected.size} file${selected.size !== 1 ? "s" : ""}` : ""}
            </Button>
          </div>

          {filteredFiles.length === 0 ? (
            <div className="flex items-center justify-center py-16 border border-dashed rounded-lg text-muted-foreground/40 text-sm">
              {search.trim() ? "No files match your search" : "No files in this library"}
            </div>
          ) : viewMode === "grid" ? (
            <VirtualizedGrid
              items={filteredFiles}
              getKey={(f) => f.id}
              mode="grid"
              itemHeight={180}
              itemAspectRatio={16 / 9}
              itemChromeHeight={48}
              minColumnWidth={200}
              maxHeight="70vh"
              resetKey={`${libraryId}-${sortKey}-${sortDir}-${search}`}
              renderItem={(f) => (
                <FileGridCard
                  file={f}
                  selected={selected.has(f.id)}
                  onToggle={() => toggleFile(f.id)}
                  onPlay={() => setPlayingFile(f)}
                  badge={
                    <span
                      className={cn(
                        "text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/60 font-mono",
                        estimateSize(f, codec, crf, speed) > f.size
                          ? "text-red-400"
                          : savingsPct(f, codec, crf, speed) > 0
                            ? "text-green-400"
                            : "text-muted-foreground/60",
                      )}
                    >
                      {(() => {
                        const est = estimateSize(f, codec, crf, speed);
                        const pct = savingsPct(f, codec, crf, speed);
                        const growing = est > f.size;
                        return growing ? `+${Math.abs(pct)}%` : pct > 0 ? `-${pct}%` : "—";
                      })()}
                    </span>
                  }
                />
              )}
            />
          ) : (
            <div className="border border-border/50 rounded-lg overflow-hidden">
              {/* Headers */}
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/30 bg-muted/20">
                <span className="w-4 shrink-0" />
                <ColHeader
                  label="Filename"
                  sortKey="filename"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  className="flex-1"
                />
                <ColHeader
                  label="Codec"
                  sortKey="codec"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  className="w-14 justify-end shrink-0"
                />
                <ColHeader
                  label="Duration"
                  sortKey="duration"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  className="w-14 justify-end shrink-0"
                />
                <ColHeader
                  label="Current"
                  sortKey="size"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  className="w-16 justify-end shrink-0"
                />
                <span className="w-16 text-right shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/40">
                  Estimated
                </span>
                <ColHeader
                  label="Savings"
                  sortKey="savings"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  className="w-14 justify-end shrink-0"
                />
                <span className="w-6 shrink-0" />
              </div>
              <VirtualizedGrid
                items={filteredFiles}
                getKey={(f) => f.id}
                mode="list"
                itemHeight={44}
                maxHeight="70vh"
                resetKey={`${libraryId}-${sortKey}-${sortDir}-${search}`}
                renderItem={(f) => (
                  <FileListRow
                    file={f}
                    selected={selected.has(f.id)}
                    onToggle={() => toggleFile(f.id)}
                    onPlay={() => setPlayingFile(f)}
                    trailing={
                      <>
                        <span
                          className={cn(
                            "text-xs shrink-0 w-16 text-right font-mono",
                            estimateSize(f, codec, crf, speed) > f.size
                              ? "text-red-400"
                              : "text-muted-foreground/70",
                          )}
                        >
                          {formatSize(estimateSize(f, codec, crf, speed))}
                        </span>
                        <span
                          className={cn(
                            "text-xs shrink-0 w-14 text-right font-semibold",
                            estimateSize(f, codec, crf, speed) > f.size
                              ? "text-red-400"
                              : savingsPct(f, codec, crf, speed) > 0
                                ? "text-green-400"
                                : "text-muted-foreground/50",
                          )}
                        >
                          {(() => {
                            const est = estimateSize(f, codec, crf, speed);
                            const pct = savingsPct(f, codec, crf, speed);
                            const growing = est > f.size;
                            return growing ? `+${Math.abs(pct)}%` : pct > 0 ? `-${pct}%` : "—";
                          })()}
                        </span>
                      </>
                    }
                  />
                )}
              />
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
