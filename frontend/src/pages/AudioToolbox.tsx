import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench, X, Loader2, Search } from "lucide-react";
import { api, audioFilesApi, audioLibrariesApi, audioToolboxApi, qk } from "@/lib/api";
import type { AudioToolboxStartBody } from "@/lib/api/audioToolbox";
import type { AudioFile } from "@/types/audio";
import {
  FileListRow,
  filterByFilename,
  ColHeader,
  applySortDir,
  type SortDir,
} from "@/components/FileSelectGrid";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useSelection } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import {
  AudioToolboxFixChips,
  type AudioFixKey,
  type AudioFixValues,
} from "@/components/audio-toolbox/AudioToolboxFixChips";
import { LibraryBar, KeepOriginalsToggle } from "@/components/LibraryBar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SortKey = "filename" | "codec" | "duration" | "size";

const AUDIO_FIX_DEFAULTS: AudioFixValues = {
  trimStart: 0,
  trimEnd: 0,
  channelOp: "mono",
};

function sortFiles(files: AudioFile[], key: SortKey, dir: SortDir): AudioFile[] {
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

export function AudioToolbox() {
  const queryClient = useQueryClient();
  const [libraryId, setLibraryId] = useState<number | null>(null);

  // Fixes: which chips are active + their shared values
  const [activeFixes, setActiveFixes] = useState<Set<AudioFixKey>>(() => new Set());
  const [fixValues, setFixValues] = useState<AudioFixValues>(AUDIO_FIX_DEFAULTS);
  const [keepOriginal, setKeepOriginal] = useState(true);

  const addFix = (key: AudioFixKey) => setActiveFixes((s) => new Set(s).add(key));
  const removeFix = (key: AudioFixKey) =>
    setActiveFixes((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });

  const {
    selected,
    setSelected,
    toggle: toggleFile,
    selectAll: selectAllIds,
    selectNone,
  } = useSelection();
  const { sortKey, sortDir, toggleSort: handleSort } = useSort<SortKey>("filename");
  const [playingFile, setPlayingFile] = useState<AudioFile | null>(null);

  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { data: libraries = [] } = useQuery({
    queryKey: qk.audioLibraries(),
    queryFn: () => audioLibrariesApi.listLibraries(),
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
    queryKey: qk.audioFiles(libraryId ?? -1),
    queryFn: () => audioFilesApi.list(libraryId as number),
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

  useLiveFiles("audio", libraryId, () => {
    if (libraryId != null) {
      queryClient.invalidateQueries({ queryKey: qk.audioFiles(libraryId) });
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
        queryClient.invalidateQueries({ queryKey: qk.audioFiles(job.library_id) });
      }
    },
  });

  const { data: allJobs } = useQuery({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(100),
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (allJobs) resumeJobPoll(allJobs, (j) => j.type === "audio_toolbox");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allJobs]);

  const hasFix = activeFixes.size > 0;

  const handleStart = async () => {
    if (selectedFiles.length === 0 || !hasFix || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const body: AudioToolboxStartBody = {
        file_ids: selectedFiles.map((f) => f.id),
        trim_start: activeFixes.has("trim") ? fixValues.trimStart : 0,
        trim_end: activeFixes.has("trim") ? fixValues.trimEnd : 0,
        channel_op: activeFixes.has("channel") ? fixValues.channelOp : null,
        normalize: activeFixes.has("normalize"),
        keep_original: keepOriginal,
      };
      const { job_id } = await audioToolboxApi.start(body);
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
    <div className="p-4 md:p-8 space-y-6 h-full flex flex-col">
      {playingFile && (
        <VideoPlayerModal
          file={playingFile}
          streamUrl={audioFilesApi.streamUrl(playingFile.id)}
          isAudio
          onClose={() => setPlayingFile(null)}
        />
      )}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Toolbox</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Trim, fix channels, and normalize loudness — stack as many as you need, one job, one pass.
          Originals saved to <code className="font-mono text-xs">_originals/</code> when enabled.
        </p>
      </div>

      <div className="shrink-0 space-y-3">
        <LibraryBar
          libraries={libraries}
          libraryId={libraryId}
          onLibraryChange={setLibraryId}
          right={<KeepOriginalsToggle checked={keepOriginal} onChange={setKeepOriginal} />}
        />
        <div className="rounded-lg border bg-card p-4">
          <AudioToolboxFixChips
            active={activeFixes}
            values={fixValues}
            onAdd={addFix}
            onRemove={removeFix}
            onChange={(p) => setFixValues((v) => ({ ...v, ...p }))}
          />
        </div>
      </div>

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
                      clickAction="select"
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
          No audio libraries yet — add one on the Libraries page
        </div>
      )}
    </div>
  );
}
