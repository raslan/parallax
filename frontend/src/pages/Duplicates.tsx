import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2, ShieldCheck, Trash2, Play } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { RowContextMenu, buildRowActions } from "@/components/RowMenu";
import { QueryError } from "@/components/QueryError";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/Skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, qk } from "@/lib/api";
import { anyCriteriaEnabled, type DuplicateGroup } from "@/lib/clusterDuplicates";
import {
  CRITERIA_KEY,
  LIVE_QUIET_MS,
  audioDialsStale,
  criteriaReachFurther,
  ignoreLiveStream,
  loadCriteria,
  measuredAudioDials,
} from "@/lib/duplicateCriteria";
import type { DuplicateCriteria } from "@/types/duplicate";
import type { VideoFile } from "@/types/file";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VideoThumbnail } from "@/components/VideoThumbnail";
import { DuplicateCriteriaPanel } from "@/components/duplicates/DuplicateCriteriaPanel";
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
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { WorkingState } from "@/components/WorkingState";
import { useClusterDuplicates } from "@/hooks/useClusterDuplicates";
import { useConfirm } from "@/components/ConfirmProvider";
import { PageTitle } from "@/components/PageTitle";

// Stable reference so `files` doesn't get a fresh `[]` identity every render
// while the query has no data yet (e.g. still loading, or erroring with no
// backend) — a fresh identity would re-trigger the `groups`-driven effect
// below every render and infinite-loop.
const EMPTY_FILES: VideoFile[] = [];

function FileCard({
  file,
  isChecked,
  isSuggested,
  onToggle,
  onPlay,
}: {
  file: VideoFile;
  isChecked: boolean;
  isSuggested: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  const actions = buildRowActions({ onPlay, path: file.path });
  return (
    <RowContextMenu actions={actions}>
      <div
        className={`h-full rounded-lg border p-3 space-y-2 transition-colors ${
          isChecked ? "border-destructive/40 bg-destructive/5" : "border-border"
        }`}
      >
        <div className="relative aspect-video w-full rounded overflow-hidden bg-muted group/thumb">
          <VideoThumbnail
            fileId={file.id}
            alt={file.filename}
            imgClassName="w-full h-full object-cover"
            iconClassName="h-6 w-6 text-muted-foreground"
          />
          <button
            onClick={onPlay}
            title="Play video"
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity"
          >
            <Play className="h-6 w-6 text-white fill-white" />
          </button>
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={`absolute top-1.5 left-1.5 h-5 w-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors z-10 ${
              isChecked
                ? "bg-destructive border-destructive"
                : "bg-background/80 border-muted-foreground hover:border-foreground"
            }`}
          >
            {isChecked && <Check className="h-3 w-3 text-white" />}
          </div>
          {isSuggested && (
            <div className="absolute top-1.5 right-1.5 bg-primary/90 text-primary-foreground text-3xs font-semibold px-1.5 py-0.5 rounded z-10">
              KEEP
            </div>
          )}
        </div>
        <p className="text-xs font-medium truncate" title={file.filename}>
          {file.filename}
        </p>
        <p className="text-xs text-muted-foreground truncate" title={file.path}>
          {file.path}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
          <span className="font-mono">{formatSize(file.size)}</span>
          {file.duration != null && (
            <span className="font-mono">{formatDuration(file.duration)}</span>
          )}
          {file.video_bitrate != null && (
            <span className="font-mono">{formatBitrate(file.video_bitrate)}</span>
          )}
          {file.codec_name && (
            <Badge variant="secondary" className="text-xs px-1 py-0">
              {file.codec_name}
            </Badge>
          )}
        </div>
      </div>
    </RowContextMenu>
  );
}

function GroupCard({
  group,
  deleteIds,
  onToggle,
  onPlay,
}: {
  group: DuplicateGroup;
  deleteIds: Set<number>;
  onToggle: (id: number) => void;
  onPlay: (f: VideoFile) => void;
}) {
  const checkedCount = group.files.filter((f) => deleteIds.has(f.id)).length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground font-normal">
          {group.files.length} copies · {formatSize(group.files[0]!.size)}
          {checkedCount > 0 && (
            <span className="ml-2 text-destructive">{checkedCount} selected for deletion</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* No independent scroll region here on purpose — a nested overflow:auto
            container (even unbounded) can end up with a sub-pixel sliver of real
            overflow, which steals the first tick of a scroll gesture from the
            outer group list. Every group's files render fully; the outer list's
            virtualization already bounds how many groups are mounted at once. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {group.files.map((f) => (
            <FileCard
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

// Shown in place of the empty state while a real duplicate scan is actually
// running (extraction job or client-side clustering) — otherwise "No
// duplicates found" reads as a false negative while work is still in flight.
function DuplicatesWorkingState({
  extracting,
  progress,
}: {
  extracting: boolean;
  progress: number;
}) {
  return extracting ? (
    <WorkingState title="Finding duplicates" message="Scanning your library…" progress={progress} />
  ) : (
    <WorkingState title="Finding duplicates" message="Comparing files…" progress={null} />
  );
}

export function Duplicates() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: libraries = [], isSuccess: librariesLoaded } = useQuery({
    queryKey: qk.libraries(),
    queryFn: () => api.getLibraries(),
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [playingFile, setPlayingFile] = useState<VideoFile | null>(null);
  const [criteria, setCriteria] = useState<DuplicateCriteria>(loadCriteria);
  const [resultsStale, setResultsStale] = useState(false);
  // Criteria the last successful extraction was scoped with — if the current
  // criteria could now include a pair that wasn't a candidate then, results
  // may be incomplete until Extract runs again. Plain state rather than a
  // ref: both writers (extract-completion callback, library-switch handler)
  // already trigger a re-render via other state changes, and reading a ref
  // during render (even indirectly, inside a useMemo) trips the React
  // Compiler's ref-safety analysis once the derived expression gets big
  // enough for it to bail out of memoizing the callback.
  const [lastExtractedCriteria, setLastExtractedCriteria] = useState<DuplicateCriteria | null>(
    null,
  );
  // Extract writes file rows, and the live stream reports those a tick or two after the job
  // says it is done — they are not changes from outside, so the stream is ignored until then
  // (see `ignoreLiveStream`). Both refs are only read inside callbacks, never during render.
  const quietUntil = useRef(0);
  // The criteria the running Extract was started with. `criteria` itself may have been edited
  // by the time the job finishes, and the results were measured with the sent ones.
  const sentCriteria = useRef<DuplicateCriteria | null>(null);

  useEffect(() => {
    localStorage.setItem(CRITERIA_KEY, JSON.stringify(criteria));
  }, [criteria]);

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
        queryClient.invalidateQueries({ queryKey: qk.duplicateFiles(selectedId) });
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
    resume(allJobs, (j) => j.type === "duplicates" && j.library_id === selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, allJobs]);

  const {
    data: files = EMPTY_FILES,
    isLoading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useQuery({
    queryKey: qk.duplicateFiles(selectedId ?? -1),
    queryFn: () => api.getDuplicateFiles(selectedId as number),
    enabled: selectedId != null,
  });

  useLiveFiles("video", selectedId, () => {
    if (ignoreLiveStream(extracting, quietUntil.current, Date.now())) return;
    setResultsStale(true);
  });

  const { groups, isComputing: clustering } = useClusterDuplicates(files, criteria);

  // The delete selection follows the computed groups (new files loaded, or
  // criteria changed): "everyone except the suggested keep" in each group,
  // with the user's own ticks and unticks laid over the top so they survive a
  // recompute. With zero criteria enabled, clusterDuplicates returns one
  // pass-through group containing the entire library (spec'd behavior) —
  // auto-selecting the whole library for deletion there would be dangerous, so
  // nothing is seeded or visible in that case and the selection stays empty.
  const { seed, visible } = useMemo(
    () => seedFromGroups(anyCriteriaEnabled(criteria) ? groups : []),
    [groups, criteria],
  );
  const {
    selected: deleteIds,
    toggle: toggleDelete,
    clear: clearDelete,
    reset: resetDelete,
  } = useSeededSelection(seed, visible);

  const handleExtract = async () => {
    if (!selectedId) return;
    sentCriteria.current = criteria;
    try {
      const { job_id } = await api.findDuplicates(selectedId, criteria);
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
      await api.deleteDuplicates(selectedId, [...deleteIds]);
      queryClient.setQueryData<VideoFile[]>(qk.duplicateFiles(selectedId), (prev) =>
        prev ? prev.filter((f) => !deleteIds.has(f.id)) : prev,
      );
      clearDelete();
    } finally {
      setDeleting(false);
    }
  };

  // Three causes for "results may be incomplete": files changed on disk (useLiveFiles above), the
  // criteria now reach further than what was last extracted for (a tolerance loosened, a new
  // extraction-tier signal just enabled), or the two Shared audio sliders that change what the
  // server measures no longer match what the stored values were measured with. That baseline is
  // recorded by the server with the job, so it survives a reload.
  const criteriaOutgrewExtraction = useMemo(
    () => lastExtractedCriteria !== null && criteriaReachFurther(criteria, lastExtractedCriteria),
    [criteria, lastExtractedCriteria],
  );
  const measuredDials = useMemo(
    () => measuredAudioDials(allJobs ?? [], "duplicates", selectedId),
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
            Toggle criteria below — matching recomputes instantly. Extract fills in the
            visual/audio/byte-hash signals those criteria need.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={handleExtract} disabled={extracting || !selectedId}>
            {extracting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                Extracting… {Math.round(progress)}%
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5 mr-2" />
                Extract
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
        <DuplicateCriteriaPanel
          criteria={criteria}
          onChange={(patch) => setCriteria((prev) => ({ ...prev, ...patch }))}
        />
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
              ? `Results may be incomplete — ${resultsStale ? "files changed" : "criteria now reach further than the last extract"}.`
              : "Shared audio was measured with different Sounds alike / Shared for at least settings than the ones set now."}
          </span>
          <Button size="sm" variant="outline" onClick={handleExtract} disabled={extracting}>
            Extract
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
          <DuplicatesWorkingState extracting={extracting} progress={progress} />
        )}

        {!filesLoading && files.length > 0 && groups.length === 0 && !extracting && !clustering && (
          <EmptyState
            icon={Copy}
            title="No duplicates found"
            description="No files match every enabled criterion. Adjust criteria above, or Extract if a signal is missing."
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
          streamUrl={api.streamUrl(playingFile.id)}
          subtitleTracksUrl={api.subtitleTracksUrl(playingFile.id)}
          onClose={() => setPlayingFile(null)}
        />
      )}
    </div>
  );
}
