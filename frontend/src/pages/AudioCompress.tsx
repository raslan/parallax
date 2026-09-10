import { useEffect, useMemo, useRef, useState } from "react";
import { Zap, Loader2, Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, audioCompressApi, audioFilesApi, audioLibrariesApi, qk } from "@/lib/api";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useSelection } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import type { AudioFile } from "@/types/audio";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { AudioEstimatePanel } from "@/components/audio-compress/AudioEstimatePanel";
import { CompressProgress } from "@/components/compress/CompressProgress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatSize } from "@/lib/format";
import { estimateAudioSize } from "@/lib/audioCompress";
import {
  FileListRow,
  filterByFilename,
  ColHeader,
  applySortDir,
  type SortDir,
} from "@/components/FileSelectGrid";

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

  const { selected, setSelected, toggle, selectAll, selectNone } = useSelection<number>();
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
  } = useQuery({
    queryKey: qk.audioFiles(libraryId ?? -1),
    queryFn: () => audioCompressApi.libraryFiles(libraryId as number),
    enabled: libraryId != null,
  });
  const loadError = filesError ? String(filesError) : null;

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

  const selectLargerThanTarget = () => {
    if (!filteredFiles) return;
    selectNone();
    selectAll(filteredFiles.filter((f) => (f.bitrate ?? 0) / 1000 > bitrate).map((f) => f.id));
  };

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
        <h1 className="text-2xl font-semibold tracking-tight">Compress</h1>
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
      {loadError && <p className="text-sm text-red-400">{loadError}</p>}

      {filteredFiles && !loadingFiles && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap shrink-0">
            <span className="text-sm text-muted-foreground">
              {filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""}
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
            <button
              onClick={selectLargerThanTarget}
              className="text-xs text-primary/70 hover:text-primary transition-colors underline underline-offset-2"
              title={`Select files whose bitrate is above ${bitrate}k`}
            >
              Larger than target
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
            <Button
              onClick={handleStart}
              disabled={selectedFiles.length === 0 || isRunning || starting}
            >
              {starting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Compress{" "}
              {selectedFiles.length > 0
                ? `${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""}`
                : ""}
            </Button>
          </div>

          {filteredFiles.length === 0 ? (
            <div className="flex items-center justify-center py-16 border border-dashed rounded-lg text-muted-foreground/40 text-sm">
              {search.trim() ? "No files match your search" : "No files in this library"}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col border border-border/50 rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/30 bg-muted/20 shrink-0">
                <span className="w-4 shrink-0" />
                <span className="w-8 shrink-0" />
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
                  items={filteredFiles}
                  getKey={(f) => f.id}
                  mode="list"
                  itemHeight={48}
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

      {libraries.length === 0 && !loadingFiles && (
        <div className="flex items-center justify-center py-16 border border-dashed rounded-lg text-muted-foreground/40 text-sm">
          No audio libraries yet — add one on the Libraries page
        </div>
      )}
    </div>
  );
}
