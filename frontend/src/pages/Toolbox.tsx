import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Wrench,
  X,
  Loader2,
  LayoutGrid,
  List,
  Search,
  RotateCw,
  RotateCcw,
  RefreshCw,
} from "lucide-react";
import { toolboxApi, api, qk } from "@/lib/api";
import type { VideoFile } from "@/types/file";
import {
  FileGridCard,
  FileListRow,
  ColHeader,
  applySortDir,
  filterByFilename,
  SortDir,
} from "@/components/FileSelectGrid";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useSelection } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { GridSizeControl } from "@/components/GridSizeControl";
import { useGridSize } from "@/hooks/useGridSize";
import { CollapsibleControls } from "@/components/CollapsibleControls";
import { SectionHeader } from "@/components/SectionHeader";
import { FilterAccordion } from "@/components/FilterAccordion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SortKey = "filename" | "codec" | "duration" | "size";
type RotateDeg = 90 | 180 | 270;
type AudioChannel = "auto" | "left" | "right";

function sortFiles(files: VideoFile[], key: SortKey, dir: SortDir): VideoFile[] {
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
    }
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  return applySortDir(sorted, dir);
}

export function Toolbox() {
  const queryClient = useQueryClient();
  const [libraryId, setLibraryId] = useState<number | null>(null);

  // Fix settings
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [audioChannel, setAudioChannel] = useState<AudioChannel | null>(null);
  const [rotateDeg, setRotateDeg] = useState<RotateDeg | null>(null);
  const [normalize, setNormalize] = useState(false);
  const [faststart, setFaststart] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncOffsetMs, setSyncOffsetMs] = useState(0);
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
  const [startError, setStartError] = useState<string | null>(null);

  const { data: libraries = [] } = useQuery({
    queryKey: qk.libraries(),
    queryFn: () => api.getLibraries(),
  });

  // Default to the first library once they load.
  useEffect(() => {
    if (libraryId == null && libraries.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLibraryId(libraries[0].id);
    }
  }, [libraries, libraryId]);

  const {
    data: files = null,
    isLoading: loadingFiles,
    error: filesError,
  } = useQuery({
    queryKey: qk.toolboxFiles(libraryId ?? -1),
    queryFn: () => toolboxApi.libraryFiles(libraryId as number),
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

  const displayFiles = useMemo(
    () => (files ? sortFiles(files, sortKey, sortDir) : null),
    [files, sortKey, sortDir],
  );
  const filteredFiles = useMemo(
    () => (displayFiles ? filterByFilename(displayFiles, search) : null),
    [displayFiles, search],
  );

  const selectAll = () => filteredFiles && selectAllIds(filteredFiles.map((f) => f.id));

  const selectedFiles = useMemo(
    () => (filteredFiles ?? []).filter((f) => selected.has(f.id)),
    [filteredFiles, selected],
  );

  useLiveFiles("video", libraryId, () => {
    if (libraryId != null) {
      queryClient.invalidateQueries({ queryKey: qk.toolboxFiles(libraryId) });
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
        queryClient.invalidateQueries({ queryKey: qk.toolboxFiles(job.library_id) });
      }
    },
  });

  const { data: allJobs } = useQuery({ queryKey: qk.jobs(), queryFn: () => api.getJobs(100) });
  useEffect(() => {
    if (allJobs) resumeJobPoll(allJobs, (j) => j.type === "toolbox_fix");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJobs]);

  const hasFix =
    trimEnabled ||
    audioChannel != null ||
    rotateDeg != null ||
    normalize ||
    faststart ||
    syncEnabled;
  const enabledFixCount = [
    trimEnabled,
    audioChannel != null,
    rotateDeg != null,
    normalize,
    faststart,
    syncEnabled,
  ].filter(Boolean).length;

  const handleStart = async () => {
    if (selectedFiles.length === 0 || !hasFix || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const { job_id } = await toolboxApi.start({
        file_ids: selectedFiles.map((f) => f.id),
        trim_start: trimEnabled ? trimStart : 0,
        trim_end: trimEnabled ? trimEnd : 0,
        audio_channel: audioChannel,
        rotate_deg: rotateDeg,
        normalize,
        faststart,
        sync_offset_ms: syncEnabled && syncOffsetMs !== 0 ? syncOffsetMs : null,
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

  return (
    <div className="p-8 space-y-6 h-full flex flex-col">
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
          Trim, fix audio, rotate, normalize, and other lossless-where-possible per-file fixes.
          Stack as many as you need — one job, one pass. Originals saved to{" "}
          <code className="font-mono text-xs">_originals/</code> when enabled.
        </p>
      </div>

      <CollapsibleControls
        storageKey="toolbox-controls"
        summary={
          <>
            {libraries.find((l) => l.id === libraryId)?.name ?? "No library"} ·{" "}
            {enabledFixCount > 0
              ? `${enabledFixCount} fix${enabledFixCount !== 1 ? "es" : ""} selected`
              : "No fixes selected"}
            {keepOriginal ? " · keep originals" : ""}
          </>
        }
      >
        <div className="p-4 space-y-4">
          {/* Settings panel */}
          <div className="rounded-lg border border-border/50 bg-muted/10 divide-y divide-border/40">
            <div className="px-5 py-4 flex items-center gap-8">
              <div className="w-40 shrink-0">
                <p className="text-xs font-medium text-foreground">Library</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  Source of files to fix
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

            {/* Output */}
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
                    replacing.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Tools — accordion list, room to grow */}
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            <FilterAccordion
              label="Trim"
              summary={trimEnabled ? `${trimStart}s start, ${trimEnd}s end` : null}
              enabled={trimEnabled}
              onToggle={(v) => {
                setTrimEnabled(v);
                if (!v) {
                  setTrimStart(0);
                  setTrimEnd(0);
                }
              }}
            >
              <p className="text-[11px] text-muted-foreground/60 mb-3">
                Cut seconds off the start and/or end. Stream-copied — instant.
              </p>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  Start
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={trimStart}
                    onChange={(e) => setTrimStart(Math.max(0, Number(e.target.value)))}
                    className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />{" "}
                  sec
                </label>
                <label className="flex items-center gap-2 text-sm">
                  End
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(Math.max(0, Number(e.target.value)))}
                    className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />{" "}
                  sec
                </label>
              </div>
            </FilterAccordion>

            <FilterAccordion
              label="Audio Channel"
              summary={audioChannel != null ? audioChannel : null}
              enabled={audioChannel != null}
              onToggle={(v) => setAudioChannel(v ? "auto" : null)}
            >
              <p className="text-[11px] text-muted-foreground/60 mb-3">
                Fix one-ear audio by copying one channel to both.
              </p>
              <div className="flex gap-2">
                {(["auto", "left", "right"] as const).map((opt) => {
                  const active = audioChannel === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => setAudioChannel(opt)}
                      className={cn(
                        "h-9 px-3 rounded-md border text-sm capitalize transition-colors",
                        active
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground",
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </FilterAccordion>

            <FilterAccordion
              label="Rotate"
              summary={rotateDeg != null ? `${rotateDeg}°` : null}
              enabled={rotateDeg != null}
              onToggle={(v) => setRotateDeg(v ? 90 : null)}
            >
              <p className="text-[11px] text-muted-foreground/60 mb-3">
                Actually rotates pixels — forces a re-encode (near-lossless CRF 18).
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setRotateDeg(90)}
                  className={cn(
                    "h-9 px-3 rounded-md border text-sm flex items-center gap-1.5 transition-colors",
                    rotateDeg === 90
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <RotateCw className="h-3.5 w-3.5" /> 90° CW
                </button>
                <button
                  onClick={() => setRotateDeg(270)}
                  className={cn(
                    "h-9 px-3 rounded-md border text-sm flex items-center gap-1.5 transition-colors",
                    rotateDeg === 270
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> 90° CCW
                </button>
                <button
                  onClick={() => setRotateDeg(180)}
                  className={cn(
                    "h-9 px-3 rounded-md border text-sm flex items-center gap-1.5 transition-colors",
                    rotateDeg === 180
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> 180°
                </button>
              </div>
            </FilterAccordion>

            <FilterAccordion
              label="Normalize Volume"
              summary={null}
              enabled={normalize}
              onToggle={setNormalize}
            >
              <p className="text-[11px] text-muted-foreground/60">
                Even out loudness (EBU R128, single-pass).
              </p>
            </FilterAccordion>

            <FilterAccordion
              label="Faststart"
              summary={null}
              enabled={faststart}
              onToggle={setFaststart}
            >
              <p className="text-[11px] text-muted-foreground/60">
                Move moov atom to front — fixes slow-to-seek mp4/m4v/mov.
              </p>
            </FilterAccordion>

            <FilterAccordion
              label="A/V Sync Offset"
              summary={syncEnabled ? `${syncOffsetMs}ms` : null}
              enabled={syncEnabled}
              onToggle={(v) => {
                setSyncEnabled(v);
                if (!v) setSyncOffsetMs(0);
              }}
            >
              <p className="text-[11px] text-muted-foreground/60 mb-3">
                Shift audio relative to video. Positive delays audio, negative advances it.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="number"
                  step={10}
                  value={syncOffsetMs}
                  onChange={(e) => setSyncOffsetMs(Number(e.target.value))}
                  className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />{" "}
                ms
              </label>
            </FilterAccordion>
          </div>
        </div>
      </CollapsibleControls>

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
                ? "Fix complete"
                : jobStatus === "cancelled"
                  ? "Cancelled"
                  : jobStatus === "failed"
                    ? "Fix failed"
                    : jobCurrentFile
                      ? `Fixing: ${jobCurrentFile}`
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

      {loadingFiles && (
        <div className="flex items-center gap-3 text-muted-foreground/60 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading library files…
        </div>
      )}
      {loadError && <p className="text-sm text-red-400">{loadError}</p>}

      {filteredFiles && !loadingFiles && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
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

            <Button
              onClick={handleStart}
              disabled={selected.size === 0 || !hasFix || isRunning || starting}
              title={!hasFix ? "Pick at least one fix" : undefined}
            >
              {starting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wrench className="h-4 w-4 mr-2" />
              )}
              Fix{" "}
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
                  />
                )}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col border border-border/50 rounded-lg overflow-hidden">
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
                  label="Size"
                  sortKey="size"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  className="w-16 justify-end shrink-0"
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
