import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Loader2, ScanSearch, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/Skeletons";
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
import {
  LIVE_QUIET_MS,
  audioCriteriaReachFurther,
  audioDialsStale,
  ignoreLiveStream,
  measuredAudioDials,
} from "@/lib/duplicateCriteria";
import type { AudioFile } from "@/types/audio";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { AudioDuplicateCriteriaPanel } from "@/components/audio-duplicates/AudioDuplicateCriteriaPanel";
import { LibraryBar } from "@/components/LibraryBar";
import {
  formatSize,
  formatDuration,
  formatBitrate,
  describeSelection,
  sumSizeOf,
} from "@/lib/format";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useJobPoll } from "@/hooks/useJobPoll";
import { seedFromGroups, useSeededSelection } from "@/hooks/useSeededSelection";
import { useWorkerRequest } from "@/hooks/useWorkerRequest";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { FileListRow } from "@/components/FileSelectGrid";
import { WorkingState } from "@/components/WorkingState";
import { useConfirm } from "@/components/ConfirmProvider";
import { PageTitle } from "@/components/PageTitle";

// Stable reference so `files` doesn't get a fresh `[]` identity every render
// while the query has no data yet — a fresh identity would re-trigger the
// clustering effect every render.
const EMPTY_FILES: AudioFile[] = [];
const EMPTY_GROUPS: AudioDuplicateGroup[] = [];

const createClusterWorker = () =>
  new Worker(new URL("@/lib/clusterAudioDuplicates.worker.ts", import.meta.url), {
    type: "module",
  });

// Runs clusterAudioDuplicates() in a Web Worker (the shared `useWorkerRequest`
// plumbing, same as hooks/useClusterDuplicates for the video page) so the O(n^2)
// fingerprint stage never blocks the main thread. Stale responses are dropped via a
// request-id check.
function useClusterAudioDuplicates(files: AudioFile[], criteria: AudioDuplicateCriteria) {
  const request = useMemo(() => ({ files, criteria }), [files, criteria]);
  const { response, pending } = useWorkerRequest<ClusterRequest, ClusterResponse>(
    createClusterWorker,
    request,
    { initialPending: false },
  );
  return { groups: response?.groups ?? EMPTY_GROUPS, isComputing: pending };
}

function DuplicateColumns({ file }: { file: AudioFile }) {
  return (
    <div className="flex shrink-0 items-center gap-x-3 text-xs text-muted-foreground tabular-nums">
      <span className="font-mono">{formatSize(file.size)}</span>
      {file.duration != null && <span className="font-mono">{formatDuration(file.duration)}</span>}
      {file.bitrate != null && <span className="font-mono">{formatBitrate(file.bitrate)}</span>}
      {file.codec_name && (
        <Badge variant="secondary" className="px-1 py-0 text-xs">
          {file.codec_name}
        </Badge>
      )}
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
          {group.files.map((f) => {
            const isSuggested = f.id === group.keep_id && !deleteIds.has(f.id);
            return (
              <FileListRow
                key={f.id}
                file={f}
                className="rounded-md border"
                clickAction="play"
                selected={deleteIds.has(f.id)}
                onToggle={() => onToggle(f.id)}
                onPlay={() => onPlay(f)}
                columns={<DuplicateColumns file={f} />}
                trailing={
                  isSuggested ? (
                    <span className="shrink-0 rounded bg-primary/90 px-1.5 py-0.5 text-3xs font-semibold text-primary-foreground">
                      KEEP
                    </span>
                  ) : null
                }
              />
            );
          })}
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
  const [deleting, setDeleting] = useState(false);
  const [playingFile, setPlayingFile] = useState<AudioFile | null>(null);
  const [criteria, setCriteria] = useState<AudioDuplicateCriteria>(DEFAULT_AUDIO_CRITERIA);
  const [resultsStale, setResultsStale] = useState(false);
  const [lastExtractedCriteria, setLastExtractedCriteria] = useState<AudioDuplicateCriteria | null>(
    null,
  );
  // This page's own run writes file rows, and the live stream reports those a tick or two
  // after the job says it is done — they are not changes from outside, so the stream is
  // ignored until then (see `ignoreLiveStream`). Both refs are only read inside callbacks.
  const quietUntil = useRef(0);
  // The criteria the running Find duplicates was started with: `criteria` may have been
  // edited by the time the job finishes, and the results were measured with the sent ones.
  const sentCriteria = useRef<AudioDuplicateCriteria | null>(null);

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
      quietUntil.current = Date.now() + LIVE_QUIET_MS;
      if (job.status === "completed" && selectedId != null) {
        queryClient.invalidateQueries({ queryKey: qk.audioFiles(selectedId) });
        setResultsStale(false);
        setLastExtractedCriteria(sentCriteria.current ?? criteria);
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

  const {
    data: files = EMPTY_FILES,
    isLoading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useQuery({
    queryKey: qk.audioFiles(selectedId ?? -1),
    queryFn: () => audioFilesApi.list(selectedId as number),
    enabled: selectedId != null,
  });

  useLiveFiles("audio", selectedId, () => {
    if (ignoreLiveStream(extracting, quietUntil.current, Date.now())) return;
    setResultsStale(true);
  });

  const { groups, isComputing: clustering } = useClusterAudioDuplicates(files, criteria);

  // The delete selection follows the computed groups — "everyone except the
  // suggested keep" in each group — with the user's own ticks laid over the top
  // so they survive a recompute. Nothing is seeded when no criteria are
  // enabled (clusterAudioDuplicates returns nothing then anyway).
  const { seed, visible } = useMemo(
    () => seedFromGroups(anyAudioCriteriaEnabled(criteria) ? groups : []),
    [groups, criteria],
  );
  const {
    selected: deleteIds,
    toggle: toggleDelete,
    clear: clearDelete,
    reset: resetDelete,
  } = useSeededSelection(seed, visible);

  const handleFindDuplicates = async () => {
    if (!selectedId) return;
    sentCriteria.current = criteria;
    try {
      const { job_id } = await audioDuplicatesApi.findDuplicates(selectedId, criteria);
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
        description: `Move ${describeSelection(deleteIds.size, "file", sumSizeOf(files, deleteIds))} to _originals/ and remove from library?`,
        confirmText: "Move",
        destructive: true,
      }))
    )
      return;
    setDeleting(true);
    try {
      await audioFilesApi.deleteFiles([...deleteIds]);
      queryClient.invalidateQueries({ queryKey: qk.audioFiles(selectedId) });
      clearDelete();
    } finally {
      setDeleting(false);
    }
  };

  // "Results may be incomplete": files changed on disk (useLiveFiles), the criteria now reach
  // further than the last Find duplicates run, or the two Shared audio sliders that change what
  // the server measures no longer match what the stored values were measured with. That
  // baseline is recorded by the server with the job, so it survives a reload — unlike this
  // page's criteria, which are page state and start from the defaults on every visit.
  const criteriaOutgrewExtraction = useMemo(
    () =>
      lastExtractedCriteria !== null && audioCriteriaReachFurther(criteria, lastExtractedCriteria),
    [criteria, lastExtractedCriteria],
  );
  const measuredDials = useMemo(
    () => measuredAudioDials(allJobs ?? [], "audio_duplicates", selectedId),
    [allJobs, selectedId],
  );
  const dialsStale = useMemo(
    () => audioDialsStale(criteria, measuredDials, lastExtractedCriteria),
    [criteria, measuredDials, lastExtractedCriteria],
  );
  const showStaleBanner = resultsStale || criteriaOutgrewExtraction || dialsStale;

  const recoverable = groups.reduce(
    (sum, g) => sum + g.files.filter((f) => deleteIds.has(f.id)).reduce((s, f) => s + f.size, 0),
    0,
  );

  return (
    <div className="p-4 md:p-8 space-y-6 h-full flex flex-col">
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <PageTitle>Duplicates</PageTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Toggle criteria below — matching recomputes instantly. Find duplicates measures which
            tracks share audio, which the Shared audio criterion needs.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={handleFindDuplicates} disabled={extracting || !selectedId}>
            {extracting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                Scanning… {Math.round(progress)}%
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
            resetDelete();
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
            {resultsStale || criteriaOutgrewExtraction
              ? `Results may be incomplete — ${resultsStale ? "files changed" : "criteria now reach further than the last run"}.`
              : "Shared audio was measured with different Sounds alike / Shared for at least settings than the ones set now."}
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
        {filesLoading && <ListSkeleton rows={6} />}
        {filesError && <QueryError error={filesError} onRetry={() => void refetchFiles()} />}

        {!filesLoading && files.length > 0 && groups.length === 0 && (extracting || clustering) && (
          <WorkingState
            title="Finding duplicates"
            message="Comparing your library's audio…"
            progress={extracting ? progress : null}
          />
        )}

        {!filesLoading && files.length > 0 && groups.length === 0 && !extracting && !clustering && (
          <EmptyState
            icon={Copy}
            title="No duplicates found"
            description="No files match every enabled criterion. Adjust criteria above, or run Find duplicates if shared audio hasn't been measured yet."
          />
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
