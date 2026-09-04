import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2, ShieldCheck, Trash2, Play } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, qk } from "@/lib/api";
import { clusterDuplicates, type DuplicateGroup } from "@/lib/clusterDuplicates";
import type { DuplicateCriteria } from "@/types/duplicate";
import type { VideoFile } from "@/types/file";
import type { Library } from "@/types/library";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { VideoThumbnail } from "@/components/VideoThumbnail";
import { DuplicateCriteriaPanel } from "@/components/duplicates/DuplicateCriteriaPanel";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useJobPoll } from "@/hooks/useJobPoll";
import { useSelection } from "@/hooks/useSelection";

// Stable reference so `files` doesn't get a fresh `[]` identity every render
// while the query has no data yet (e.g. still loading, or erroring with no
// backend) — a fresh identity would re-trigger the `groups`-driven effect
// below every render and infinite-loop.
const EMPTY_FILES: VideoFile[] = [];

function LibrarySelector({
  libraries,
  selected,
  onChange,
}: {
  libraries: Library[];
  selected: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <select
      className="bg-card border border-border text-sm rounded-md px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      value={selected ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {libraries.map((lib) => (
        <option key={lib.id} value={lib.id}>
          {lib.name}
        </option>
      ))}
    </select>
  );
}

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
  return (
    <div
      className={`flex-1 min-w-[180px] max-w-[260px] rounded-lg border p-3 space-y-2 transition-colors ${
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
          <div className="absolute top-1.5 right-1.5 bg-primary/90 text-primary-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded z-10">
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
        <div className="flex flex-wrap gap-3">
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

const CRITERIA_KEY = "parallax-dup-criteria-v2"; // v2: shape changed (10 fields), don't reuse v1's key

function loadCriteria(): DuplicateCriteria {
  try {
    const stored = localStorage.getItem(CRITERIA_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // fall through to defaults
  }
  return {
    use_size: true,
    use_duration: true,
    duration_tolerance: 1,
    use_resolution: false,
    use_content_date: false,
    content_date_tolerance: 86400,
    use_orientation: false,
    use_bitrate: false,
    bitrate_tolerance_pct: 10,
    use_filename: false,
    filename_threshold: 0.4,
    use_byte_hash: false,
    use_phash: true,
    phash_threshold: 10,
    phash_mode: "all_frames",
    phash_frames: 16,
    use_audio: false,
    audio_threshold: 0.9,
  };
}

export function Duplicates() {
  const queryClient = useQueryClient();
  const { data: libraries = [], isSuccess: librariesLoaded } = useQuery({
    queryKey: qk.libraries(),
    queryFn: () => api.getLibraries(),
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { selected: deleteIds, setSelected: setDeleteIds, toggle: toggleDelete } = useSelection();
  const [deleting, setDeleting] = useState(false);
  const [playingFile, setPlayingFile] = useState<VideoFile | null>(null);
  const [criteria, setCriteria] = useState<DuplicateCriteria>(loadCriteria);
  const [resultsStale, setResultsStale] = useState(false);
  // Criteria the last successful extraction was scoped with — if the current
  // criteria could now include a pair that wasn't a candidate then, results
  // may be incomplete until Extract runs again.
  const lastExtractedCriteriaRef = useRef<DuplicateCriteria | null>(null);

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
      if (job.status === "completed" && selectedId != null) {
        queryClient.invalidateQueries({ queryKey: qk.duplicateFiles(selectedId) });
        setResultsStale(false);
        lastExtractedCriteriaRef.current = criteria;
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

  const { data: files = EMPTY_FILES, isLoading: filesLoading } = useQuery({
    queryKey: qk.duplicateFiles(selectedId ?? -1),
    queryFn: () => api.getDuplicateFiles(selectedId as number),
    enabled: selectedId != null,
  });

  useLiveFiles("video", selectedId, () => setResultsStale(true));

  const groups = useMemo(() => clusterDuplicates(files, criteria), [files, criteria]);

  // Seed/refresh the delete selection whenever the computed groups change
  // (new files loaded, or criteria changed) — always "everyone except the
  // suggested keep," same as before, just recomputed instead of fetched.
  useEffect(() => {
    const init = new Set<number>();
    groups.forEach((g) =>
      g.files.forEach((f) => {
        if (f.id !== g.keep_id) init.add(f.id);
      }),
    );
    setDeleteIds(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const handleExtract = async () => {
    if (!selectedId) return;
    try {
      const { job_id } = await api.findDuplicates(selectedId, criteria);
      start(job_id);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const handleDelete = async () => {
    if (!selectedId || deleteIds.size === 0) return;
    if (!confirm(`Move ${deleteIds.size} file(s) to _originals/ and remove from library?`)) return;
    setDeleting(true);
    try {
      await api.deleteDuplicates(selectedId, [...deleteIds]);
      queryClient.setQueryData<VideoFile[]>(qk.duplicateFiles(selectedId), (prev) =>
        prev ? prev.filter((f) => !deleteIds.has(f.id)) : prev,
      );
      setDeleteIds(new Set());
    } finally {
      setDeleting(false);
    }
  };

  // Two causes for "results may be incomplete": files changed on disk
  // (useLiveFiles above), or the current criteria now reach further than
  // what was last extracted for (e.g. duration tolerance loosened, or a
  // new extraction-tier signal just enabled).
  const criteriaOutgrewExtraction = useMemo(() => {
    // Reading a ref inside useMemo: intentional. `lastExtractedCriteriaRef` is
    // only ever written from the extract-completion callback and the
    // library-switch handler, both of which already trigger a re-render via
    // other state changes, so this read never needs to independently drive one.
    /* eslint-disable react-hooks/refs */
    const last = lastExtractedCriteriaRef.current;
    if (!last) return false;
    return (
      criteria.duration_tolerance > last.duration_tolerance ||
      criteria.content_date_tolerance > last.content_date_tolerance ||
      criteria.bitrate_tolerance_pct > last.bitrate_tolerance_pct ||
      (criteria.use_byte_hash && !last.use_byte_hash) ||
      (criteria.use_phash && !last.use_phash) ||
      (criteria.use_phash && criteria.phash_frames !== last.phash_frames) ||
      (criteria.use_phash && criteria.phash_mode !== last.phash_mode) ||
      (criteria.use_audio && !last.use_audio)
    );
    /* eslint-enable react-hooks/refs */
  }, [criteria]);
  const showStaleBanner = resultsStale || criteriaOutgrewExtraction;

  const recoverable = groups.reduce(
    (sum, g) => sum + g.files.filter((f) => deleteIds.has(f.id)).reduce((s, f) => s + f.size, 0),
    0,
  );

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionHeader className="mb-1.5">Duplicate detection</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Toggle criteria below — matching recomputes instantly. Extract fills in the
            visual/audio/byte-hash signals those criteria need.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {libraries.length > 0 && (
            <LibrarySelector
              libraries={libraries}
              selected={selectedId}
              onChange={(id) => {
                setSelectedId(id);
                setDeleteIds(new Set());
                lastExtractedCriteriaRef.current = null;
              }}
            />
          )}
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

      <Card>
        <CardHeader className="pb-1 pt-4 px-5">
          <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Match Criteria
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <DuplicateCriteriaPanel
            criteria={criteria}
            onChange={(patch) => setCriteria((prev) => ({ ...prev, ...patch }))}
          />
        </CardContent>
      </Card>

      {jobError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {jobError}
        </div>
      )}

      {showStaleBanner && groups.length > 0 && (
        <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-sm">
          <span className="text-amber-400">
            Results may be incomplete —{" "}
            {resultsStale ? "files changed" : "criteria now reach further than the last extract"}.
          </span>
          <Button size="sm" variant="outline" onClick={handleExtract} disabled={extracting}>
            Extract
          </Button>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold tabular-nums font-mono">{groups.length}</span> duplicate
            group{groups.length !== 1 ? "s" : ""} found
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

      {filesLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!filesLoading && files.length > 0 && groups.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Copy className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No duplicates found</h3>
            <p className="text-sm text-muted-foreground">
              No files match every enabled criterion. Adjust criteria above, or Extract if a signal
              is missing.
            </p>
          </CardContent>
        </Card>
      )}

      {groups.length > 0 && (
        <div className="space-y-4">
          {groups.map((group, i) => (
            <GroupCard
              key={i}
              group={group}
              deleteIds={deleteIds}
              onToggle={toggleDelete}
              onPlay={setPlayingFile}
            />
          ))}
        </div>
      )}

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
