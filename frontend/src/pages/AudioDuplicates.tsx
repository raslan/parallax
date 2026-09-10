import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Loader2, ScanSearch, Trash2, Play } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { audioDuplicatesApi, audioFilesApi, audioLibrariesApi, api, qk } from "@/lib/api";
import type {
  AudioDuplicateGroup,
  ClusterRequest,
  ClusterResponse,
} from "@/lib/clusterAudioDuplicates";
import {
  anyAudioCriteriaEnabled,
  DEFAULT_AUDIO_CRITERIA,
  type AudioDuplicateCriteria,
} from "@/types/audioDuplicate";
import type { AudioFile } from "@/types/audio";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { AudioDuplicateCriteriaPanel } from "@/components/audio-duplicates/AudioDuplicateCriteriaPanel";
import { LibraryBar } from "@/components/LibraryBar";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useSelection } from "@/hooks/useSelection";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { WorkingState } from "@/components/WorkingState";
import { useConfirm } from "@/components/ConfirmProvider";

// Stable reference so `files` doesn't get a fresh `[]` identity every render
// while the query has no data yet — a fresh identity would re-trigger the
// clustering effect every render.
const EMPTY_FILES: AudioFile[] = [];
const EMPTY_GROUPS: AudioDuplicateGroup[] = [];

// Runs clusterAudioDuplicates() in a Web Worker (mirrors
// hooks/useClusterDuplicates for the video page) so the O(n^2) fingerprint
// stage never blocks the main thread. Stale responses are dropped via a
// request-id check.
function useClusterAudioDuplicates(files: AudioFile[], criteria: AudioDuplicateCriteria) {
  const [groups, setGroups] = useState<AudioDuplicateGroup[]>(EMPTY_GROUPS);
  const [isComputing, setIsComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL("@/lib/clusterAudioDuplicates.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<ClusterResponse>) => {
      if (event.data.requestId !== requestIdRef.current) return; // stale
      setGroups(event.data.groups);
      setIsComputing(false);
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = ++requestIdRef.current;
    setIsComputing(true);
    const message: ClusterRequest = { requestId, files, criteria };
    worker.postMessage(message);
  }, [files, criteria]);

  return { groups, isComputing };
}

function FileRow({
  file,
  isChecked,
  isSuggested,
  onToggle,
  onPlay,
}: {
  file: AudioFile;
  isChecked: boolean;
  isSuggested: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
        isChecked ? "border-destructive/40 bg-destructive/5" : "border-border"
      }`}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
          isChecked
            ? "bg-destructive border-destructive"
            : "bg-background/80 border-muted-foreground hover:border-foreground"
        }`}
      >
        {isChecked && <span className="h-2 w-2 rounded-sm bg-white" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={file.filename}>
          {file.filename}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={file.path}>
          {file.path}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-x-3 text-xs text-muted-foreground tabular-nums">
        <span className="font-mono">{formatSize(file.size)}</span>
        {file.duration != null && (
          <span className="font-mono">{formatDuration(file.duration)}</span>
        )}
        {file.bitrate != null && <span className="font-mono">{formatBitrate(file.bitrate)}</span>}
        {file.codec_name && (
          <Badge variant="secondary" className="px-1 py-0 text-xs">
            {file.codec_name}
          </Badge>
        )}
      </div>
      {isSuggested && (
        <span className="shrink-0 rounded bg-primary/90 px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">
          KEEP
        </span>
      )}
      <button
        onClick={onPlay}
        title="Play audio"
        className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        <Play className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function GroupCard({
  group,
  deleteIds,
  onToggle,
  onPlay,
}: {
  group: AudioDuplicateGroup;
  deleteIds: Set<number>;
  onToggle: (id: number) => void;
  onPlay: (f: AudioFile) => void;
}) {
  const checkedCount = group.files.filter((f) => deleteIds.has(f.id)).length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-muted-foreground">
          {group.files.length} copies · {formatSize(group.files[0]!.size)}
          {checkedCount > 0 && (
            <span className="ml-2 text-destructive">{checkedCount} selected for deletion</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {group.files.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              isChecked={deleteIds.has(f.id)}
              isSuggested={f.id === group.keep_id && !deleteIds.has(f.id)}
              onToggle={() => onToggle(f.id)}
              onPlay={() => onPlay(f)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function AudioDuplicates() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: libraries = [], isSuccess: librariesLoaded } = useQuery({
    queryKey: qk.audioLibraries(),
    queryFn: () => audioLibrariesApi.listLibraries(),
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { selected: deleteIds, setSelected: setDeleteIds, toggle: toggleDelete } = useSelection();
  const [deleting, setDeleting] = useState(false);
  const [playingFile, setPlayingFile] = useState<AudioFile | null>(null);
  const [criteria, setCriteria] = useState<AudioDuplicateCriteria>(DEFAULT_AUDIO_CRITERIA);
  const [resultsStale, setResultsStale] = useState(false);
  const [lastExtractedCriteria, setLastExtractedCriteria] = useState<AudioDuplicateCriteria | null>(
    null,
  );

  useEffect(() => {
    if (selectedId != null || !librariesLoaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (libraries.length > 0) setSelectedId(libraries[0]!.id);
  }, [libraries, librariesLoaded, selectedId]);

  const { data: allJobs } = useQuery({
    queryKey: qk.jobs(),
    queryFn: () => api.getJobs(100),
    refetchOnMount: "always",
  });

  const {
    status,
    progress,
    error: jobError,
    start,
    resume,
  } = useJobPoll({
    onTerminal: (job) => {
      if (job.status === "completed" && selectedId != null) {
        queryClient.invalidateQueries({ queryKey: qk.audioFiles(selectedId) });
        setResultsStale(false);
        setLastExtractedCriteria(criteria);
      }
      if (job.status === "failed" && job.error) {
        toast.error(job.error);
      }
    },
  });
  const extracting = status === "pending" || status === "running";

  useEffect(() => {
    if (!selectedId || !allJobs) return;
    resume(allJobs, (j) => j.type === "audio_duplicates" && j.library_id === selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, allJobs]);

  const { data: files = EMPTY_FILES, isLoading: filesLoading } = useQuery({
    queryKey: qk.audioFiles(selectedId ?? -1),
    queryFn: () => audioFilesApi.list(selectedId as number),
    enabled: selectedId != null,
  });

  useLiveFiles("audio", selectedId, () => setResultsStale(true));

  const { groups, isComputing: clustering } = useClusterAudioDuplicates(files, criteria);

  // Seed the delete selection whenever the computed groups change — "everyone
  // except the suggested keep" per group. Skip when no criteria are enabled
  // (clusterAudioDuplicates returns nothing then anyway).
  useEffect(() => {
    if (!anyAudioCriteriaEnabled(criteria)) {
      setDeleteIds(new Set());
      return;
    }
    const init = new Set<number>();
    groups.forEach((g) =>
      g.files.forEach((f) => {
        if (f.id !== g.keep_id) init.add(f.id);
      }),
    );
    setDeleteIds(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, criteria]);

  const handleFindDuplicates = async () => {
    if (!selectedId) return;
    try {
      const { job_id } = await audioDuplicatesApi.findDuplicates(selectedId);
      start(job_id);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const handleDelete = async () => {
    if (!selectedId || deleteIds.size === 0) return;
    if (
      !(await confirm({
        title: "Move to originals?",
        description: `Move ${deleteIds.size} file(s) to _originals/ and remove from library?`,
        confirmText: "Move",
        destructive: true,
      }))
    )
      return;
    setDeleting(true);
    try {
      await audioFilesApi.deleteFiles([...deleteIds]);
      queryClient.invalidateQueries({ queryKey: qk.audioFiles(selectedId) });
      setDeleteIds(new Set());
    } finally {
      setDeleting(false);
    }
  };

  // "Results may be incomplete": files changed on disk (useLiveFiles), or the
  // current criteria now reach further than the last fingerprint extract.
  const criteriaOutgrewExtraction = useMemo(() => {
    const last = lastExtractedCriteria;
    if (!last) return false;
    return (
      criteria.duration_tolerance > last.duration_tolerance ||
      criteria.content_date_tolerance > last.content_date_tolerance ||
      (criteria.use_audio && !last.use_audio) ||
      (!criteria.use_size && last.use_size) ||
      (!criteria.use_duration && last.use_duration) ||
      (!criteria.use_content_date && last.use_content_date)
    );
  }, [criteria, lastExtractedCriteria]);
  const showStaleBanner = resultsStale || criteriaOutgrewExtraction;

  const recoverable = groups.reduce(
    (sum, g) => sum + g.files.filter((f) => deleteIds.has(f.id)).reduce((s, f) => s + f.size, 0),
    0,
  );

  return (
    <div className="p-4 md:p-8 space-y-6 h-full flex flex-col">
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Toggle criteria below — matching recomputes instantly. Find duplicates fills in the
            audio fingerprint signal the fingerprint criterion needs.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={handleFindDuplicates} disabled={extracting || !selectedId}>
            {extracting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                Fingerprinting… {Math.round(progress)}%
              </>
            ) : (
              <>
                <ScanSearch className="h-3.5 w-3.5 mr-2" />
                Find duplicates
              </>
            )}
          </Button>
        </div>
      </div>

      {libraries.length > 0 && (
        <LibraryBar
          libraries={libraries}
          libraryId={selectedId}
          onLibraryChange={(id) => {
            setSelectedId(id);
            setDeleteIds(new Set());
            setLastExtractedCriteria(null);
          }}
        />
      )}

      <div className="shrink-0 rounded-lg border bg-card p-4">
        <AudioDuplicateCriteriaPanel criteria={criteria} onChange={setCriteria} />
      </div>

      {jobError && (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {jobError}
        </div>
      )}

      {showStaleBanner && groups.length > 0 && (
        <div className="shrink-0 flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm">
          <span className="text-amber-400">
            Results may be incomplete —{" "}
            {resultsStale ? "files changed" : "criteria now reach further than the last run"}.
          </span>
          <Button size="sm" variant="outline" onClick={handleFindDuplicates} disabled={extracting}>
            Find duplicates
          </Button>
        </div>
      )}

      {groups.length > 0 && (
        <div className="shrink-0 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold tabular-nums font-mono">{groups.length}</span> duplicate
            group{groups.length !== 1 ? "s" : ""} found
            {clustering && (
              <span className="text-muted-foreground ml-2 inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> recomputing…
              </span>
            )}
            {deleteIds.size > 0 && (
              <span className="text-muted-foreground ml-2">
                · <span className="font-mono font-semibold text-foreground">{deleteIds.size}</span>{" "}
                selected for deletion
                {recoverable > 0 && <span> · {formatSize(recoverable)} recoverable</span>}
              </span>
            )}
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleting || deleteIds.size === 0}
          >
            {deleting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete {deleteIds.size > 0 ? deleteIds.size : ""} Selected
              </>
            )}
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {filesLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!filesLoading && files.length > 0 && groups.length === 0 && (extracting || clustering) && (
          <WorkingState
            title="Finding duplicates"
            message="Fingerprinting your library…"
            progress={extracting ? progress : null}
          />
        )}

        {!filesLoading && files.length > 0 && groups.length === 0 && !extracting && !clustering && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Copy className="h-10 w-10 text-muted-foreground mb-4" />
              <h3 className="font-semibold text-lg mb-1">No duplicates found</h3>
              <p className="text-sm text-muted-foreground">
                No files match every enabled criterion. Adjust criteria above, or run Find
                duplicates if the fingerprint signal is missing.
              </p>
            </CardContent>
          </Card>
        )}

        {groups.length > 0 && (
          <div className="flex-1 min-h-0">
            <VirtualizedGrid
              mode="list"
              dynamicHeight
              items={groups}
              getKey={(group) => group.keep_id}
              itemHeight={220}
              gap={16}
              resetKey={`${selectedId}-${groups.length}`}
              renderItem={(group) => (
                <GroupCard
                  group={group}
                  deleteIds={deleteIds}
                  onToggle={toggleDelete}
                  onPlay={setPlayingFile}
                />
              )}
            />
          </div>
        )}
      </div>

      {playingFile && (
        <VideoPlayerModal
          file={playingFile}
          streamUrl={audioFilesApi.streamUrl(playingFile.id)}
          isAudio
          onClose={() => setPlayingFile(null)}
        />
      )}
    </div>
  );
}
