import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, LayoutGrid, List, Loader2, Merge, Search } from "lucide-react";
import { api, compressApi, qk, spliceApi } from "@/lib/api";
import type { VideoFile } from "@/types/file";
import {
  ColHeader,
  FileGridCard,
  FileListRow,
  applySortDir,
  filterByFilename,
  type SortDir,
} from "@/components/FileSelectGrid";
import { CompressProgress } from "@/components/compress/CompressProgress";
import { GridSizeControl } from "@/components/GridSizeControl";
import { LibraryBar } from "@/components/LibraryBar";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VideoThumbnail } from "@/components/VideoThumbnail";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { Button } from "@/components/ui/button";
import { useGridSize } from "@/hooks/useGridSize";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useSelection } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import {
  defaultOutputName,
  moveItem,
  sortOrder,
  syncOrder,
  type SortMode,
} from "@/lib/spliceOrder";
import { cn } from "@/lib/utils";
import { MergeSheet } from "./MergeSheet";

// Mirrors `GPU_FAILED_PREFIX` in backend/app/services/splice.py.
const GPU_FAILED_PREFIX = "GPU encode failed";

type SortKey = "filename" | "codec" | "duration" | "size";

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

export function MergeTab() {
  const queryClient = useQueryClient();
  const [libraryId, setLibraryId] = useState<number | null>(null);

  const { selected, setSelected } = useSelection();
  const [order, setOrder] = useState<number[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode | null>(null);
  const [reverse, setReverse] = useState(false);

  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [chapters, setChapters] = useState(true);
  const [codec, setCodec] = useState("h264");
  const [crfOverride, setCrfOverride] = useState<number | null>(null);
  const [speed, setSpeed] = useState("medium");
  const [referenceId, setReferenceId] = useState<number | null>(null);

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
      setLibraryId(libraries[0]!.id);
    }
  }, [libraries, libraryId]);

  const {
    data: files = null,
    isLoading: loadingFiles,
    error: filesError,
  } = useQuery({
    queryKey: qk.spliceFiles(libraryId ?? -1),
    queryFn: () => spliceApi.libraryFiles(libraryId as number),
    enabled: libraryId != null,
  });
  const loadError = filesError ? String(filesError) : null;

  const { data: codecs = [] } = useQuery({
    queryKey: qk.compressCodecs(),
    queryFn: () => compressApi.codecs(),
  });
  const codecInfo = codecs.find((c) => c.id === codec);
  const crf = crfOverride ?? codecInfo?.default_crf ?? 23;

  // Clear the merge when switching libraries.
  const handleLibraryChange = (id: number) => {
    setLibraryId(id);
    setSelected(new Set());
    setOrder([]);
    setSheetOpen(false);
    setReferenceId(null);
  };

  // Prune selection to still-existing files after a live refetch. `order` needs no
  // pruning: `orderedFiles` skips missing ids and the next `syncOrder` drops them.
  useEffect(() => {
    if (!files) return;
    const ids = new Set(files.map((f) => f.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [files, setSelected]);

  const byId = useMemo(() => new Map((files ?? []).map((f) => [f.id, f])), [files]);

  const displayFiles = useMemo(
    () => (files ? sortFiles(files, sortKey, sortDir) : null),
    [files, sortKey, sortDir],
  );
  const filteredFiles = useMemo(
    () => (displayFiles ? filterByFilename(displayFiles, search) : null),
    [displayFiles, search],
  );

  // Selection changes also re-sync the merge order in the same handler.
  const applySelection = (next: Set<number>) => {
    setSelected(next);
    setOrder((prev) => syncOrder(prev, next, byId));
    if (referenceId != null && !next.has(referenceId)) setReferenceId(null);
  };
  const toggleFile = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applySelection(next);
  };
  const selectAll = () => filteredFiles && applySelection(new Set(filteredFiles.map((f) => f.id)));
  const selectNone = () => applySelection(new Set());

  const orderedFiles = useMemo(
    () => order.map((id) => byId.get(id)).filter((f): f is VideoFile => !!f),
    [order, byId],
  );
  const ids = orderedFiles.map((f) => f.id);

  const effectiveName = nameOverride ?? defaultOutputName(orderedFiles);

  useLiveFiles("video", libraryId, () => {
    if (libraryId != null) {
      queryClient.invalidateQueries({ queryKey: qk.spliceFiles(libraryId) });
    }
  });

  const { data: preflight, isFetching: preflightLoading } = useQuery({
    queryKey: qk.splicePreflight(ids, referenceId, effectiveName.trim(), codec),
    queryFn: () =>
      spliceApi.preflight({
        file_ids: ids,
        reference_file_id: referenceId,
        output_name: effectiveName.trim() || null,
        codec,
      }),
    enabled: sheetOpen && ids.length >= 2,
    placeholderData: keepPreviousData,
    retry: false,
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
        queryClient.invalidateQueries({ queryKey: qk.spliceFiles(job.library_id) });
      }
    },
  });

  const { data: allJobs } = useQuery({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(100),
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (allJobs) resumeJobPoll(allJobs, (j) => j.type === "splice_merge");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJobs]);

  const handleMerge = async () => {
    if (!preflight || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const { job_id } = await spliceApi.merge({
        file_ids: ids,
        output_name: effectiveName.trim(),
        chapters,
        reencode:
          preflight.verdict === "reencode"
            ? { codec, crf, speed, reference_file_id: preflight.reference_file_id }
            : null,
      });
      startJobPoll(job_id);
      setSheetOpen(false);
      applySelection(new Set());
      setNameOverride(null);
    } catch (e: unknown) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const handleRetryCpu = async () => {
    if (jobId == null) return;
    setStartError(null);
    try {
      const { job_id } = await spliceApi.retryCpu(jobId);
      startJobPoll(job_id);
    } catch (e: unknown) {
      setStartError(e instanceof Error ? e.message : String(e));
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
  const gpuFailed = jobStatus === "failed" && !!jobError?.startsWith(GPU_FAILED_PREFIX);

  return (
    <div className="h-full flex flex-col gap-6">
      {playingFile && (
        <VideoPlayerModal
          file={playingFile}
          streamUrl={api.streamUrl(playingFile.id)}
          subtitleTracksUrl={api.subtitleTracksUrl(playingFile.id)}
          onClose={() => setPlayingFile(null)}
        />
      )}

      <p className="text-sm text-muted-foreground">
        Join videos into one new file, in the order you choose. Originals are moved to{" "}
        <code className="font-mono text-xs">_originals/</code>.
      </p>

      <div className="shrink-0">
        <LibraryBar
          libraries={libraries}
          libraryId={libraryId}
          onLibraryChange={handleLibraryChange}
        />
      </div>

      {(isRunning || isDone) && jobId != null && (
        <div className="space-y-2">
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
          {gpuFailed && (
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" onClick={handleRetryCpu}>
                <Cpu className="h-3.5 w-3.5 mr-1.5" />
                Retry with CPU
              </Button>
              <span className="text-xs text-muted-foreground">
                The GPU encoder failed. Your files are untouched.
              </span>
            </div>
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
              onClick={() => setSheetOpen(true)}
              disabled={selected.size < 2 || isRunning}
              title={selected.size < 2 ? "Select at least two files" : undefined}
            >
              <Merge className="h-4 w-4 mr-2" />
              Merge {selected.size > 0 ? `${selected.size} files` : ""}
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
                <span className="w-14 shrink-0" />
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
              </div>
              <div className="flex-1 min-h-[200px]">
                <VirtualizedGrid
                  items={filteredFiles}
                  getKey={(f) => f.id}
                  mode="list"
                  itemHeight={50}
                  resetKey={`${libraryId}-${sortKey}-${sortDir}-${search}`}
                  renderItem={(f) => (
                    <FileListRow
                      file={f}
                      selected={selected.has(f.id)}
                      onToggle={() => toggleFile(f.id)}
                      onPlay={() => setPlayingFile(f)}
                      thumbnail={
                        <VideoThumbnail
                          fileId={f.id}
                          scannedAt={f.scanned_at}
                          alt={f.filename}
                          imgClassName="h-8 w-14 object-cover rounded"
                          iconClassName="h-3.5 w-3.5 text-muted-foreground/40"
                          fallbackClassName="h-8 w-14 bg-muted rounded"
                        />
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

      <MergeSheet
        open={sheetOpen && ids.length >= 2}
        onOpenChange={setSheetOpen}
        files={orderedFiles}
        preflight={preflight}
        preflightLoading={preflightLoading}
        codecs={codecs}
        outputName={effectiveName}
        onOutputNameChange={setNameOverride}
        chapters={chapters}
        onChaptersChange={setChapters}
        codec={codec}
        onCodecChange={(c) => {
          setCodec(c);
          setCrfOverride(null);
        }}
        crf={crf}
        onCrfChange={setCrfOverride}
        speed={speed}
        onSpeedChange={setSpeed}
        referenceId={referenceId}
        onReferenceChange={setReferenceId}
        sortMode={sortMode}
        reverse={reverse}
        onSort={(mode) => {
          setSortMode(mode);
          setOrder((prev) => sortOrder(prev, byId, mode, reverse));
        }}
        onReverse={() => {
          setReverse((r) => !r);
          setOrder((prev) => [...prev].reverse());
        }}
        onReorder={(from, to) => {
          setSortMode(null);
          setOrder((prev) => moveItem(prev, from, to));
        }}
        onRemove={(id) => {
          const next = new Set(selected);
          next.delete(id);
          applySelection(next);
        }}
        starting={starting}
        startError={isDone ? null : startError}
        onMerge={handleMerge}
      />
    </div>
  );
}
