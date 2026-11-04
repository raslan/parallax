import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Images as ImagesIcon, Loader2, SearchX, Sparkles } from "lucide-react";
import { api, imageApi, qk, upscaleApi } from "@/lib/api";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useGridSize } from "@/hooks/useGridSize";
import { useSelection, useSelectionOrder } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import type { ImageFile } from "@/types/image";
import type {
  UpscaleResizeMode,
  UpscaleScale,
  UpscaleSkipped,
  UpscaleTierId,
} from "@/types/upscale";
import { EmptyState, NoLibrariesState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { ToolbarSearch, ViewToggle } from "@/components/DataToolbar";
import { useConfirm } from "@/components/ConfirmProvider";
import { LibraryBar } from "@/components/LibraryBar";
import { RadioToggle } from "@/components/RadioToggle";
import { GridSizeControl } from "@/components/GridSizeControl";
import { ImageThumbnail } from "@/components/ImageThumbnail";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { SelectionBar } from "@/components/SelectionBar";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { CompressProgress } from "@/components/compress/CompressProgress";
import { UpscalePanel } from "@/components/image-upscale/UpscalePanel";
import {
  ColHeader,
  FileGridCard,
  FileListRow,
  applySortDir,
  filterByFilename,
  type SortDir,
} from "@/components/FileSelectGrid";
import { Button } from "@/components/ui/button";
import { describeSelection, formatSize, sumSizeOf } from "@/lib/format";
import { exceedsCap, outputDims } from "@/lib/upscale";

type SortKey = "filename" | "size" | "pixels";

const FETCH_ALL_PAGE_SIZE = 10000;

const UPSCALE_LABELS = {
  done: "Upscale complete",
  failed: "Upscale failed",
  running: (file: string) => `Upscaling: ${file}`,
};

const pixels = (f: ImageFile) => (f.width ?? 0) * (f.height ?? 0);

function sortImages(files: ImageFile[], key: SortKey, dir: SortDir): ImageFile[] {
  const sorted = [...files].sort((a, b) => {
    switch (key) {
      case "filename":
        return a.filename.localeCompare(b.filename, undefined, { numeric: true });
      case "size":
        return a.size - b.size;
      case "pixels":
        return pixels(a) - pixels(b);
    }
  });
  return applySortDir(sorted, dir);
}

const dimsLabel = (f: ImageFile) => (f.width && f.height ? `${f.width}×${f.height}` : "—");

export function ImageUpscale() {
  const qc = useQueryClient();
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [tier, setTier] = useState<UpscaleTierId>("fast");
  const [scale, setScale] = useState<UpscaleScale>(4); // the default tier's native scale
  const [resizeMode, setResizeMode] = useState<UpscaleResizeMode>("size");
  const [prescale, setPrescale] = useState(50);
  const [forceCpu, setForceCpu] = useState(false);
  const [originals, setOriginals] = useState<"keep" | "quarantine" | "overwrite">("keep");
  const replace = originals !== "keep";
  const keepOriginal = originals !== "overwrite";
  const confirm = useConfirm();

  const { selected, setSelected, toggle, selectAll, selectNone, setOrder, marqueeProps } =
    useSelection<number>();
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("filename");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [gridSize, setGridSize] = useGridSize(200);
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<ImageFile | null>(null);
  const [skipped, setSkipped] = useState<UpscaleSkipped[]>([]);

  const { data: libraries = [] } = useQuery({
    queryKey: qk.imageLibraries(),
    queryFn: () => imageApi.listLibraries(),
  });
  const { data: tierData } = useQuery({
    queryKey: qk.upscaleTiers(),
    queryFn: () => upscaleApi.tiers(),
    staleTime: Infinity,
  });
  const tiers = tierData?.tiers ?? [];
  const gpuAvailable = tierData?.gpu_available ?? false;

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
    refetch: refetchFiles,
  } = useQuery({
    queryKey: qk.images({ upscaleLibrary: libraryId }),
    queryFn: async () =>
      (
        await imageApi.listImages({
          library_id: libraryId as number,
          page: 1,
          page_size: FETCH_ALL_PAGE_SIZE,
          sort_by: "filename",
          sort_dir: "asc",
        })
      ).items,
    enabled: libraryId != null,
  });

  const changeLibrary = (id: number) => {
    setLibraryId(id);
    setSelected(new Set());
    setSkipped([]);
  };

  useEffect(() => {
    if (!files) return;
    setSelected((prev) => {
      const ids = new Set(files.map((f) => f.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [files, setSelected]);

  useLiveFiles("image", libraryId, () => {
    void qc.invalidateQueries({ queryKey: qk.images() });
  });

  const filteredFiles = useMemo(
    () => (files ? filterByFilename(sortImages(files, sortKey, sortDir), search) : null),
    [files, sortKey, sortDir, search],
  );
  const orderedIds = useMemo(() => (filteredFiles ?? []).map((f) => f.id), [filteredFiles]);
  useSelectionOrder(setOrder, orderedIds);

  const selectedFiles = useMemo(
    () => (filteredFiles ?? []).filter((f) => selected.has(f.id)),
    [filteredFiles, selected],
  );
  const selectedBytes = sumSizeOf(selectedFiles, selected);

  // The largest selected image decides the "→ W×H" line and the 150 MP guard.
  const largest = useMemo(
    () =>
      selectedFiles.reduce<ImageFile | null>(
        (best, f) => (f.width && f.height && (!best || pixels(f) > pixels(best)) ? f : best),
        null,
      ),
    [selectedFiles],
  );
  const sampleDims = largest ? { w: largest.width as number, h: largest.height as number } : null;
  // Pre-scaling always runs the model at its own native scale; output size picks the scale.
  const native = (tiers.find((t) => t.id === tier)?.scale ?? 2) as UpscaleScale;
  const prescaling = resizeMode === "prescale";
  const effScale = prescaling ? native : scale;
  const effPrescale = prescaling ? prescale : 100;
  const overCap = sampleDims
    ? exceedsCap(sampleDims.w, sampleDims.h, effScale, effPrescale)
    : false;
  const out = sampleDims ? outputDims(sampleDims.w, sampleDims.h, effScale, effPrescale) : null;

  const {
    jobId,
    status: jobStatus,
    progress: jobProgress,
    currentFile: jobCurrentFile,
    error: jobError,
    start: startJobPoll,
    resume: resumeJobPoll,
  } = useJobPoll({
    onTerminal: () => {
      void qc.invalidateQueries({ queryKey: qk.images() });
    },
  });

  const { data: allJobs } = useQuery({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(100),
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (allJobs) resumeJobPoll(allJobs, (j) => j.type === "image_upscale");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJobs]);

  const start = useMutation({
    mutationFn: () =>
      upscaleApi.start({
        file_ids: selectedFiles.map((f) => f.id),
        tier,
        scale: effScale,
        prescale: effPrescale,
        replace,
        keep_original: keepOriginal,
        force_cpu: forceCpu,
      }),
    onSuccess: (res) => {
      setSkipped(res.skipped);
      startJobPoll(res.job_id);
    },
  });

  const handleStart = async () => {
    // Replacing without keeping the original overwrites it for good, so ask first.
    if (
      replace &&
      !keepOriginal &&
      !(await confirm({
        title: "Replace originals?",
        description: `${describeSelection(selectedFiles.length, "image", selectedBytes)} will be permanently overwritten by the upscaled copies. Choose "Replace" instead to move them to quarantine.`,
        confirmText: "Replace",
        destructive: true,
      }))
    )
      return;
    start.mutate();
  };

  const handleCancel = async () => {
    if (jobId == null) return;
    try {
      await api.cancelJob(jobId);
    } catch {
      /* ignore */
    }
  };

  const isRunning = jobStatus === "running" || jobStatus === "pending";
  const isDone = jobStatus === "completed" || jobStatus === "failed" || jobStatus === "cancelled";
  const nameOf = (id: number) => files?.find((f) => f.id === id)?.filename ?? `#${id}`;

  return (
    <div className="p-4 md:p-8 space-y-6 h-full flex flex-col">
      {viewing && <ImageViewerModal img={viewing} onClose={() => setViewing(null)} />}

      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Upscale</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Make bigger copies of your images. Each copy is saved next to its original, which is never
          changed.
        </p>
      </div>

      <div className="shrink-0 space-y-3">
        <LibraryBar
          libraries={libraries}
          libraryId={libraryId}
          onLibraryChange={changeLibrary}
          right={
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="shrink-0 text-sm text-muted-foreground">Originals</span>
                <RadioToggle
                  value={originals}
                  onChange={setOriginals}
                  options={[
                    { id: "keep", label: "Keep both" },
                    { id: "quarantine", label: "Replace" },
                    { id: "overwrite", label: "Overwrite" },
                  ]}
                />
              </div>
              <span className="text-2xs leading-tight text-muted-foreground/60">
                {originals === "keep" &&
                  "The upscaled copy is saved next to each original, which is not changed"}
                {originals === "quarantine" &&
                  "The copy takes the original's place; the original goes to _quarantine/ and can be restored"}
                {originals === "overwrite" &&
                  "The copy takes the original's place; the original is permanently deleted"}
              </span>
            </div>
          }
        />
        <UpscalePanel
          tiers={tiers}
          tier={tier}
          scale={scale}
          resizeMode={resizeMode}
          prescale={prescale}
          forceCpu={forceCpu}
          gpuAvailable={gpuAvailable}
          sampleDims={sampleDims}
          onTierChange={setTier}
          onScaleChange={setScale}
          onResizeModeChange={setResizeMode}
          onPrescaleChange={setPrescale}
          onForceCpuChange={setForceCpu}
        />
      </div>

      {(isRunning || isDone) && jobId != null && (
        <CompressProgress
          isRunning={isRunning}
          isDone={isDone}
          jobStatus={jobStatus}
          jobProgress={jobProgress}
          jobCurrentFile={jobCurrentFile}
          jobError={jobError}
          startError={null}
          onCancel={handleCancel}
          labels={UPSCALE_LABELS}
        />
      )}

      {skipped.length > 0 && (
        <div className="max-w-2xl shrink-0 rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-3">
          <p className="text-sm font-medium">
            {skipped.length} image{skipped.length !== 1 ? "s were" : " was"} skipped
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {skipped.map((s) => (
              <li key={s.id}>
                <span className="font-mono">{nameOf(s.id)}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loadingFiles && (
        <div className="flex items-center gap-3 text-muted-foreground/60 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading images…
        </div>
      )}
      {filesError && <QueryError error={filesError} onRetry={() => void refetchFiles()} />}

      {filteredFiles && !loadingFiles && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap shrink-0">
            <span className="text-sm text-muted-foreground">
              {filteredFiles.length} image{filteredFiles.length !== 1 ? "s" : ""}
              <span className="hidden text-muted-foreground/50 md:inline"> · drag to select</span>
            </span>
            <button
              onClick={() => selectAll(filteredFiles.map((f) => f.id))}
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
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search images…" />
            <div className="flex-1" />
            <ViewToggle value={viewMode} onChange={setViewMode} />
            {viewMode === "grid" && <GridSizeControl value={gridSize} onChange={setGridSize} />}
          </div>

          {filteredFiles.length === 0 ? (
            <EmptyState
              icon={search.trim() ? SearchX : ImagesIcon}
              title={search.trim() ? "No images match your search" : "No images in this library"}
            />
          ) : viewMode === "grid" ? (
            <div className="flex-1 min-h-[200px]">
              <VirtualizedGrid
                {...marqueeProps}
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
                    onToggle={() => toggle(f.id)}
                    onPlay={() => setViewing(f)}
                    thumbnail={
                      <ImageThumbnail
                        imageId={f.id}
                        scannedAt={f.scanned_at}
                        alt={f.filename}
                        imgClassName="w-full h-full object-cover"
                      />
                    }
                    footer={
                      <div className="flex items-center gap-2 text-3xs text-muted-foreground">
                        <span className="font-mono">{dimsLabel(f)}</span>
                        <span>{formatSize(f.size)}</span>
                      </div>
                    }
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
                  onSort={toggleSort}
                  className="flex-1"
                />
                <ColHeader
                  label="Dimensions"
                  sortKey="pixels"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  className="w-24 justify-end shrink-0"
                />
                <ColHeader
                  label="Size"
                  sortKey="size"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  className="w-16 justify-end shrink-0"
                />
              </div>
              <div className="flex-1 min-h-[200px]">
                <VirtualizedGrid
                  {...marqueeProps}
                  items={filteredFiles}
                  getKey={(f) => f.id}
                  mode="list"
                  itemHeight={50}
                  resetKey={`${libraryId}-${sortKey}-${sortDir}-${search}`}
                  renderItem={(f) => (
                    <FileListRow
                      file={f}
                      selected={selected.has(f.id)}
                      onToggle={() => toggle(f.id)}
                      onPlay={() => setViewing(f)}
                      thumbnail={
                        <ImageThumbnail
                          imageId={f.id}
                          scannedAt={f.scanned_at}
                          alt={f.filename}
                          imgClassName="h-8 w-14 rounded object-cover"
                          iconClassName="h-4 w-4 text-muted-foreground/40"
                        />
                      }
                      columns={
                        <>
                          <span className="text-xs text-muted-foreground/60 shrink-0 w-24 text-right font-mono">
                            {dimsLabel(f)}
                          </span>
                          <span className="text-xs text-muted-foreground/70 shrink-0 w-16 text-right font-mono">
                            {formatSize(f.size)}
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

      <SelectionBar
        count={selectedFiles.length}
        bytes={selectedBytes}
        onClear={selectNone}
        summary={
          overCap ? (
            <span className="text-sm text-orange-400">Too large — pick a smaller size</span>
          ) : out ? (
            <span className="flex items-center gap-2 text-sm">
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
              <span className="tabular-nums">
                {out.w}×{out.h}
              </span>
            </span>
          ) : undefined
        }
      >
        <Button
          size="sm"
          onClick={() => void handleStart()}
          disabled={isRunning || start.isPending || overCap || tiers.length === 0}
        >
          {start.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          Upscale {selectedFiles.length}
        </Button>
      </SelectionBar>

      {libraries.length === 0 && !loadingFiles && <NoLibrariesState kind="image" />}
    </div>
  );
}
