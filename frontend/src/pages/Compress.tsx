import { useState, useEffect, useMemo, useRef } from "react";
import { Zap, Loader2, TrendingDown, LayoutGrid, List, Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { compressApi, api, qk } from "@/lib/api";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useSelection } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import type { VideoFile } from "@/types/file";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { GridSizeControl } from "@/components/GridSizeControl";
import { useGridSize } from "@/hooks/useGridSize";
import { CompressEstimatePanel } from "@/components/compress/CompressEstimatePanel";
import { CompressProgress } from "@/components/compress/CompressProgress";
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
  const queryClient = useQueryClient();
  const [libraryId, setLibraryId] = useState<number | null>(null);

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
  const [gridSize, setGridSize] = useGridSize(200);
  const { sortKey, sortDir, toggleSort: handleSort } = useSort<SortKey>("filename");
  const [playingFile, setPlayingFile] = useState<VideoFile | null>(null);

  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(false);

  const { data: libraries = [] } = useQuery({
    queryKey: qk.libraries(),
    queryFn: () => api.getLibraries(),
  });
  const { data: codecs = [] } = useQuery({
    queryKey: qk.compressCodecs(),
    queryFn: () => compressApi.codecs(),
  });

  // Default to the first library once they load.
  useEffect(() => {
    if (libraryId == null && libraries.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLibraryId(libraries[0]!.id);
    }
  }, [libraries, libraryId]);

  // Seed codec + CRF from the codec list once (prefers hevc). A `useQuery`
  // refetch changes the array identity — guard so it doesn't clobber the
  // user's later codec/CRF choice.
  const codecSeeded = useRef(false);
  useEffect(() => {
    if (codecs.length === 0 || codecSeeded.current) return;
    codecSeeded.current = true;
    const first = codecs.find((x) => x.id === "hevc") ?? codecs[0]!;
    setCodec(first.id);
    setCrf(first.default_crf);
  }, [codecs]);

  const {
    data: files = null,
    isLoading: loadingFiles,
    error: filesError,
  } = useQuery({
    queryKey: qk.compressFiles(libraryId ?? -1),
    queryFn: () => compressApi.libraryFiles(libraryId as number),
    enabled: libraryId != null,
  });
  const loadError = filesError ? String(filesError) : null;

  // Clear selection when switching libraries.
  useEffect(() => {
    setSelected(new Set());
  }, [libraryId, setSelected]);

  // Prune selection to still-existing files after a live refetch.
  useEffect(() => {
    if (!files) return;
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => files.some((f) => f.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [files, setSelected]);

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

  useLiveFiles("video", libraryId, () => {
    if (libraryId != null) {
      queryClient.invalidateQueries({ queryKey: qk.compressFiles(libraryId) });
    }
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
      if (job.status === "completed" && job.library_id != null) {
        queryClient.invalidateQueries({ queryKey: qk.compressFiles(job.library_id) });
      }
    },
  });

  // Resume polling any active compress job on mount
  const { data: allJobs } = useQuery({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(100),
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (allJobs) resumeJobPoll(allJobs, (j) => j.type === "compress");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJobs]);

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
    <div className="p-4 md:p-8 space-y-6 h-full flex flex-col">
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
        <h1 className="text-2xl font-semibold tracking-tight">Compress</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Re-encode library files with modern codecs to reduce storage. Originals saved to{" "}
          <code className="font-mono text-xs">_originals/</code> when enabled.
        </p>
      </div>

      <CompressEstimatePanel
        libraries={libraries}
        libraryId={libraryId}
        onLibraryChange={setLibraryId}
        codecs={codecs}
        codec={codec}
        onCodecChange={handleCodecChange}
        speed={speed}
        onSpeedChange={setSpeed}
        crf={crf}
        onCrfChange={setCrf}
        crfRange={crfRange}
        keepOriginal={keepOriginal}
        onKeepOriginalChange={setKeepOriginal}
        files={files}
        selectedCount={selected.size}
        libraryTotalSize={libraryTotalSize}
        libraryEstSize={libraryEstSize}
        librarySavingsPct={librarySavingsPct}
        totalSourceSize={totalSourceSize}
        totalEstSize={totalEstSize}
        totalSavingsPct={totalSavingsPct}
      />

      {/* Job progress */}
      {(isRunning || isDone) && jobId != null && (
        <CompressProgress
          isRunning={isRunning}
          isDone={isDone}
          jobStatus={jobStatus}
          jobProgress={jobProgress}
          jobCurrentFile={jobCurrentFile}
          jobError={jobError}
          startError={startError}
          onCancel={handleCancel}
        />
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
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap shrink-0">
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

            {viewMode === "grid" && <GridSizeControl value={gridSize} onChange={setGridSize} />}

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
            <div className="flex-1 min-h-[200px]">
              <VirtualizedGrid
                items={filteredFiles}
                getKey={(f) => f.id}
                mode="grid"
                itemHeight={180}
                itemAspectRatio={4 / 3}
                itemChromeHeight={48}
                minColumnWidth={gridSize}
                resetKey={`${libraryId}-${sortKey}-${sortDir}-${search}-${gridSize}`}
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
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col border border-border/50 rounded-lg overflow-hidden">
              {/* Headers */}
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/30 bg-muted/20 shrink-0">
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
              <div className="flex-1 min-h-[200px]">
                <VirtualizedGrid
                  items={filteredFiles}
                  getKey={(f) => f.id}
                  mode="list"
                  itemHeight={44}
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
