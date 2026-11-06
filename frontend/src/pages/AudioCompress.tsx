import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Zap, Loader2, SearchX, TrendingDown } from "lucide-react";
import { EmptyState, NoLibrariesState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { ToolbarSearch } from "@/components/DataToolbar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, audioCompressApi, audioFilesApi, audioLibrariesApi, qk } from "@/lib/api";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useSelection, useSelectionOrder } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import type { AudioFile } from "@/types/audio";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { AudioEstimatePanel } from "@/components/audio-compress/AudioEstimatePanel";
import { CompressProgress } from "@/components/compress/CompressProgress";
import { SelectionBar } from "@/components/SelectionBar";
import { SmartSelect, type SmartSelectOption } from "@/components/SmartSelect";
import { Tip } from "@/components/Tip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatSize } from "@/lib/format";
import { estimateAudioSize, isAlreadyAtTarget } from "@/lib/audioCompress";
import {
  FileListRow,
  filterByFilename,
  ColHeader,
  applySortDir,
  type SortDir,
} from "@/components/FileSelectGrid";
import { PageTitle } from "@/components/PageTitle";

type SortKey = "filename" | "codec" | "duration" | "size" | "estimated";

function sortFiles(files: AudioFile[], key: SortKey, dir: SortDir, bitrate: number): AudioFile[] {
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
      case "estimated":
        va = estimateAudioSize(a.duration, bitrate);
        vb = estimateAudioSize(b.duration, bitrate);
        break;
    }
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
  return applySortDir(sorted, dir);
}

export function AudioCompress() {
  const qc = useQueryClient();
  const [libraryId, setLibraryId] = useState<number | null>(null);

  const [codec, setCodec] = useState("opus");
  const [bitrate, setBitrate] = useState(128);
  const [keepOriginal, setKeepOriginal] = useState(true);

  const { selected, setSelected, toggle, selectAll, selectNone, setOrder, marqueeProps } =
    useSelection<number>();
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("filename");
  const [playing, setPlaying] = useState<AudioFile | null>(null);
  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { data: libraries = [] } = useQuery({
    queryKey: qk.audioLibraries(),
    queryFn: () => audioLibrariesApi.listLibraries(),
  });
  const { data: codecs = [] } = useQuery({
    queryKey: qk.audioCompressCodecs(),
    queryFn: () => audioCompressApi.codecs(),
  });

  useEffect(() => {
    if (libraryId == null && libraries.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLibraryId(libraries[0]!.id);
    }
  }, [libraries, libraryId]);

  // Seed codec + bitrate from the codec list once (prefers opus).
  const codecSeeded = useRef(false);
  useEffect(() => {
    if (codecs.length === 0 || codecSeeded.current) return;
    codecSeeded.current = true;
    const first = codecs.find((c) => c.id === "opus") ?? codecs[0]!;
    setCodec(first.id);
    setBitrate(first.bitrate_default);
  }, [codecs]);

  const {
    data: files = null,
    isLoading: loadingFiles,
    error: filesError,
    refetch: refetchFiles,
  } = useQuery({
    queryKey: qk.audioFiles(libraryId ?? -1),
    queryFn: () => audioCompressApi.libraryFiles(libraryId as number),
    enabled: libraryId != null,
  });

  useEffect(() => {
    setSelected(new Set());
  }, [libraryId, setSelected]);

  useEffect(() => {
    if (!files) return;
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => files.some((f) => f.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [files, setSelected]);

  useLiveFiles("audio", libraryId, () => {
    if (libraryId != null) qc.invalidateQueries({ queryKey: qk.audioFiles(libraryId) });
  });

  const handleCodecChange = (id: string) => {
    setCodec(id);
    const def = codecs.find((c) => c.id === id)?.bitrate_default ?? bitrate;
    setBitrate(def);
  };

  const displayFiles = useMemo(
    () => (files ? sortFiles(files, sortKey, sortDir, bitrate) : null),
    [files, sortKey, sortDir, bitrate],
  );
  const filteredFiles = useMemo(
    () => (displayFiles ? filterByFilename(displayFiles, search) : null),
    [displayFiles, search],
  );
  const orderedIds = useMemo(() => (filteredFiles ?? []).map((f) => f.id), [filteredFiles]);
  useSelectionOrder(setOrder, orderedIds);

  const selectedFiles = useMemo(
    () => (filteredFiles ?? []).filter((f) => selected.has(f.id)),
    [filteredFiles, selected],
  );

  const currentBytes = selectedFiles.reduce((s, f) => s + f.size, 0);
  const estimatedBytes = selectedFiles.reduce(
    (s, f) => s + estimateAudioSize(f.duration, bitrate),
    0,
  );

  const libraryBytes = (filteredFiles ?? []).reduce((s, f) => s + f.size, 0);
  const libraryEstBytes = (filteredFiles ?? []).reduce(
    (s, f) => s + estimateAudioSize(f.duration, bitrate),
    0,
  );

  // Quick selections with their totals; recomputes when the target bitrate moves,
  // not on every selection change.
  const smartSets = useMemo(() => {
    const all = filteredFiles ?? [];
    const set = (id: string, label: string, hint: string, pick: (f: AudioFile) => boolean) => {
      const picked = all.filter(pick);
      return {
        id,
        label,
        hint,
        ids: picked.map((f) => f.id),
        count: picked.length,
        bytes: picked.reduce((s, f) => s + f.size, 0),
        estBytes: picked.reduce((s, f) => s + estimateAudioSize(f.duration, bitrate), 0),
      };
    };
    return [
      set(
        "bitrate",
        `above ${bitrate}k`,
        `Files above the ${bitrate}k target. A ${codec} file already within 15% of it is left out: re-encoding it would only lose quality`,
        (f) => !!f.bitrate && !isAlreadyAtTarget(f.codec_name, f.bitrate, codec, bitrate),
      ),
      set("big", "over 50 MB", "Files larger than 50 MB", (f) => f.size > 50 * 1024 ** 2),
    ];
  }, [filteredFiles, bitrate, codec]);
  const smartOptions: SmartSelectOption[] = smartSets.map(({ ids, ...s }) => ({
    ...s,
    active: ids.length > 0 && ids.length === selected.size && ids.every((id) => selected.has(id)),
    onSelect: () => selectAll(ids),
  }));

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
        qc.invalidateQueries({ queryKey: qk.audioFiles(job.library_id) });
      }
    },
  });

  const { data: allJobs } = useQuery({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(100),
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (allJobs) resumeJobPoll(allJobs, (j) => j.type === "audio_compress");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJobs]);

  const handleStart = async () => {
    if (selectedFiles.length === 0 || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const { job_id } = await audioCompressApi.start({
        file_ids: selectedFiles.map((f) => f.id),
        codec,
        bitrate,
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
      /* ignore */
    }
  };

  const isRunning = jobStatus === "running" || jobStatus === "pending";
  const isDone = jobStatus === "completed" || jobStatus === "failed" || jobStatus === "cancelled";

  return (
    <div className="p-4 md:p-8 space-y-6 h-full flex flex-col">
      {playing && (
        <VideoPlayerModal
          file={playing}
          streamUrl={audioFilesApi.streamUrl(playing.id)}
          isAudio
          onClose={() => setPlaying(null)}
        />
      )}

      <div>
        <PageTitle>Compress</PageTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Re-encode audio files to a smaller lossy codec. Originals saved to{" "}
          <code className="font-mono text-xs">_originals/</code> when enabled.
        </p>
      </div>

      <AudioEstimatePanel
        libraries={libraries}
        libraryId={libraryId}
        onLibraryChange={setLibraryId}
        codecs={codecs}
        codec={codec}
        onCodecChange={handleCodecChange}
        bitrate={bitrate}
        onBitrateChange={setBitrate}
        keepOriginal={keepOriginal}
        onKeepOriginalChange={setKeepOriginal}
        selectedCount={selectedFiles.length}
        currentBytes={currentBytes}
        estimatedBytes={estimatedBytes}
        libraryBytes={libraryBytes}
        libraryEstBytes={libraryEstBytes}
      />

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

      {loadingFiles && (
        <div className="flex items-center gap-3 text-muted-foreground/60 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading library files…
        </div>
      )}
      {filesError && <QueryError error={filesError} onRetry={() => void refetchFiles()} />}

      {filteredFiles && !loadingFiles && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <SmartSelect options={smartOptions} />
          <div className="flex items-center gap-3 flex-wrap shrink-0">
            <span className="text-sm text-muted-foreground">
              {filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""}
              <span className="hidden text-muted-foreground/50 md:inline"> · drag to select</span>
            </span>
            <button
              onClick={() => filteredFiles && selectAll(filteredFiles.map((f) => f.id))}
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
            <ToolbarSearch value={search} onChange={setSearch} />
          </div>

          {filteredFiles.length === 0 ? (
            <EmptyState
              icon={search.trim() ? SearchX : AudioLines}
              title={search.trim() ? "No files match your search" : "No files in this library"}
            />
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
                  label="Codec"
                  sortKey="codec"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  className="w-14 justify-end shrink-0"
                />
                <ColHeader
                  label="Duration"
                  sortKey="duration"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  className="w-14 justify-end shrink-0"
                />
                <ColHeader
                  label="Current"
                  sortKey="size"
                  current={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  className="w-16 justify-end shrink-0"
                />
                <ColHeader
                  label="Estimated"
                  sortKey="estimated"
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
                      clickAction="select"
                      selected={selected.has(f.id)}
                      onToggle={() => toggle(f.id)}
                      onPlay={() => setPlaying(f)}
                      trailing={
                        <Badge variant="secondary" className="font-mono text-xs w-16 justify-end">
                          {formatSize(estimateAudioSize(f.duration, bitrate))}
                        </Badge>
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
        count={selected.size}
        bytes={currentBytes}
        onClear={selectNone}
        summary={
          <span className="flex items-center gap-2 text-sm">
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <span className="tabular-nums">{formatSize(estimatedBytes)}</span>
            <Tip label="Estimate. The real size can differ.">
              <Badge
                variant="secondary"
                className={cn(
                  "font-mono text-xs",
                  estimatedBytes < currentBytes
                    ? "text-green-400 bg-green-400/10"
                    : "text-red-400 bg-red-400/10",
                )}
              >
                <TrendingDown className="h-3 w-3 mr-1" />
                {estimatedBytes < currentBytes ? "-" : "+"}
                {currentBytes > 0
                  ? Math.abs(Math.round(((currentBytes - estimatedBytes) / currentBytes) * 100))
                  : 0}
                %
              </Badge>
            </Tip>
          </span>
        }
      >
        <Button size="sm" onClick={handleStart} disabled={isRunning || starting}>
          {starting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Zap className="h-4 w-4 mr-2" />
          )}
          Compress
        </Button>
      </SelectionBar>

      {libraries.length === 0 && !loadingFiles && <NoLibrariesState kind="audio" />}
    </div>
  );
}
