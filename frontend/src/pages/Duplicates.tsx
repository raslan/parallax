import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, ShieldCheck, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, DuplicateGroup, DuplicateFile, Library, DuplicateCriteria } from "@/lib/api";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";

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
        <option key={lib.id} value={lib.id}>{lib.name}</option>
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
  file: DuplicateFile;
  isChecked: boolean;
  isSuggested: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  return (
    <div className={`flex-1 min-w-[180px] max-w-[260px] rounded-lg border p-3 space-y-2 transition-colors ${
      isChecked ? "border-destructive/40 bg-destructive/5" : "border-border"
    }`}>
      <div className="relative aspect-video w-full rounded overflow-hidden bg-muted group/thumb">
        {file.has_thumbnail ? (
          <img
            src={`/api/files/${file.id}/thumbnail`}
            alt={file.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Copy className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
        <button
          onClick={onPlay}
          title="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity"
        >
          <Play className="h-6 w-6 text-white fill-white" />
        </button>
        <div
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
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
      <p className="text-xs font-medium truncate" title={file.filename}>{file.filename}</p>
      <p className="text-xs text-muted-foreground truncate" title={file.path}>{file.path}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        <span className="font-mono">{formatSize(file.size)}</span>
        {file.duration != null && <span className="font-mono">{formatDuration(file.duration)}</span>}
        {file.video_bitrate != null && <span className="font-mono">{formatBitrate(file.video_bitrate)}</span>}
        {file.codec_name && (
          <Badge variant="secondary" className="text-xs px-1 py-0">{file.codec_name}</Badge>
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
  onPlay: (f: DuplicateFile) => void;
}) {
  const checkedCount = group.files.filter((f) => deleteIds.has(f.id)).length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground font-normal">
          {group.files.length} copies · {formatSize(group.files[0].size)}
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

const CRITERIA_KEY = "parallax-dup-criteria";

function loadCriteria(): DuplicateCriteria {
  try {
    const stored = localStorage.getItem(CRITERIA_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Backfill phash_frames if missing from old saved criteria
      if (parsed.phash_frames == null) parsed.phash_frames = 16;
      return parsed;
    }
  } catch {}
  return {
    use_size: true,
    use_duration: true,
    use_phash: true,
    duration_tolerance: 1,
    phash_threshold: 10,
    phash_mode: "all_frames",
    phash_frames: 16,
  };
}

function CriteriaRow({ label, enabled, onToggle, children }: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-2.5 border-b border-border/50 last:border-0">
      <label className="flex items-center gap-2.5 cursor-pointer select-none min-w-[140px]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="accent-[var(--px-accent)] h-3.5 w-3.5"
        />
        <span className={`text-sm font-medium ${enabled ? "text-foreground" : "text-muted-foreground"}`}>
          {label}
        </span>
      </label>
      {enabled && children && (
        <div className="flex items-center gap-4 flex-wrap">
          {children}
        </div>
      )}
    </div>
  );
}

export function Duplicates() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [playingFile, setPlayingFile] = useState<DuplicateFile | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [criteria, setCriteria] = useState<DuplicateCriteria>(loadCriteria);

  useEffect(() => {
    localStorage.setItem(CRITERIA_KEY, JSON.stringify(criteria));
  }, [criteria]);

  useEffect(() => {
    api.getLibraries().then((libs) => {
      setLibraries(libs);
      if (libs.length > 0) setSelectedId(libs[0].id);
      else setInitializing(false);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setInitializing(true);
    api.getJobs().then((jobs) => {
      const active = jobs.find(
        (j) => j.type === "duplicates" && j.library_id === selectedId &&
               (j.status === "running" || j.status === "pending")
      );
      if (!active) {
        stopPolling();
        setScanning(false);
      } else {
        setScanning(true);
        startPolling(selectedId);
      }
    }).catch(() => {}).finally(() => setInitializing(false));
  }, [selectedId]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const startPolling = (libraryId: number) => {
    stopPolling();
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 180) { stopPolling(); setScanning(false); return; }
      try {
        const result = await api.getDuplicates(libraryId);
        setGroups(result);
        const init = new Set<number>();
        result.forEach((g) => g.files.forEach((f) => { if (f.id !== g.keep_id) init.add(f.id); }));
        setDeleteIds(init);
        stopPolling();
        setScanning(false);
      } catch (e: any) {
        if (!e?.message?.startsWith("404")) { stopPolling(); setScanning(false); }
      }
    }, 2000);
  };

  const handleScan = async () => {
    if (!selectedId) return;
    stopPolling();
    setScanning(true);
    setGroups(null);
    setDeleteIds(new Set());
    try {
      await api.findDuplicates(selectedId, criteria);
    } catch {
      setScanning(false);
      return;
    }
    startPolling(selectedId);
  };

  const toggleDelete = (fileId: number) => {
    setDeleteIds((prev) => {
      const next = new Set(prev);
      next.has(fileId) ? next.delete(fileId) : next.add(fileId);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!selectedId || !groups || deleteIds.size === 0) return;
    if (!confirm(`Move ${deleteIds.size} file(s) to _originals/ and remove from library?`)) return;
    setDeleting(true);
    const toDelete = new Set(deleteIds);
    try {
      await api.deleteDuplicates(selectedId, [...toDelete]);
      setGroups((prev) =>
        prev
          ?.map((g) => ({ ...g, files: g.files.filter((f) => !toDelete.has(f.id)) }))
          .filter((g) => g.files.length > 1) ?? []
      );
      setDeleteIds(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const set = <K extends keyof DuplicateCriteria>(key: K, val: DuplicateCriteria[K]) =>
    setCriteria((prev) => ({ ...prev, [key]: val }));

  const similarityPct = Math.round((1 - criteria.phash_threshold / 64) * 100);

  const recoverable = groups
    ? groups.reduce((sum, g) =>
        sum + g.files.filter((f) => deleteIds.has(f.id)).reduce((s, f) => s + f.size, 0), 0)
    : 0;

  const noCriteria = !criteria.use_size && !criteria.use_duration && !criteria.use_phash;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionHeader className="mb-1.5">Duplicate detection</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Find videos matching the selected criteria. Check files to delete, uncheck to keep.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {libraries.length > 0 && (
            <LibrarySelector
              libraries={libraries}
              selected={selectedId}
              onChange={(id) => { setSelectedId(id); setGroups(null); setDeleteIds(new Set()); }}
            />
          )}
          <Button
            onClick={handleScan}
            disabled={scanning || !selectedId || noCriteria}
          >
            {scanning ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Scanning…</>
            ) : (
              <><ShieldCheck className="h-3.5 w-3.5 mr-2" />Find Duplicates</>
            )}
          </Button>
        </div>
      </div>

      {/* Criteria card */}
      <Card>
        <CardHeader className="pb-1 pt-4 px-5">
          <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Match Criteria
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          {/* Exact size */}
          <CriteriaRow
            label="Exact size"
            enabled={criteria.use_size}
            onToggle={() => set("use_size", !criteria.use_size)}
          >
            <span className="text-xs text-muted-foreground">Files must share the same byte size</span>
          </CriteriaRow>

          {/* Duration */}
          <CriteriaRow
            label="Duration"
            enabled={criteria.use_duration}
            onToggle={() => set("use_duration", !criteria.use_duration)}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Tolerance</span>
              <span className="text-xs text-muted-foreground">±</span>
              <input
                type="number"
                min={0}
                max={60}
                step={0.5}
                value={criteria.duration_tolerance}
                onChange={(e) => set("duration_tolerance", Math.max(0, Number(e.target.value)))}
                className="w-16 bg-muted border border-border text-sm rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
              />
              <span className="text-xs text-muted-foreground">seconds</span>
            </div>
          </CriteriaRow>

          {/* Visual / pHash */}
          <CriteriaRow
            label="Visual (pHash)"
            enabled={criteria.use_phash}
            onToggle={() => set("use_phash", !criteria.use_phash)}
          >
            {/* Similarity */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Min similarity</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={similarityPct}
                onChange={(e) => set("phash_threshold", Math.round((1 - Number(e.target.value) / 100) * 64))}
                className="w-28 accent-primary"
              />
              <span className="text-xs font-mono tabular-nums w-8">{similarityPct}%</span>
            </div>

            {/* Compare mode */}
            <div className="flex items-center gap-3">
              {(["all_frames", "first_frame"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="phash_mode"
                    value={mode}
                    checked={criteria.phash_mode === mode}
                    onChange={() => set("phash_mode", mode)}
                    className="accent-[var(--px-accent)]"
                  />
                  <span className="text-xs text-muted-foreground">
                    {mode === "all_frames" ? "All frames" : "First frame only"}
                  </span>
                </label>
              ))}
            </div>

            {/* Frame count */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Frames per video</span>
              <input
                type="number"
                min={4}
                max={64}
                step={1}
                value={criteria.phash_frames}
                onChange={(e) => set("phash_frames", Math.min(64, Math.max(4, Number(e.target.value))))}
                className="w-16 bg-muted border border-border text-sm rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
              />
            </div>
          </CriteriaRow>
        </CardContent>
      </Card>

      {/* Results summary + delete bar */}
      {groups !== null && groups.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold tabular-nums font-mono">{groups.length}</span>{" "}
            duplicate group{groups.length !== 1 ? "s" : ""} found
            {deleteIds.size > 0 && (
              <span className="text-muted-foreground ml-2">
                · <span className="font-mono font-semibold text-foreground">{deleteIds.size}</span> selected for deletion
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
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Deleting…</>
            ) : (
              <><Trash2 className="h-3.5 w-3.5 mr-2" />Delete {deleteIds.size > 0 ? deleteIds.size : ""} Selected</>
            )}
          </Button>
        </div>
      )}

      {/* Loading */}
      {scanning && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* No duplicates */}
      {!scanning && groups !== null && groups.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Copy className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No duplicates found</h3>
            <p className="text-sm text-muted-foreground">
              Every file in this library appears to be unique.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Groups */}
      {!scanning && groups && groups.length > 0 && (
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

      {/* Ready state */}
      {!scanning && groups === null && !initializing && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Copy className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">Ready to scan</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Configure criteria above and click Find Duplicates.
            </p>
          </CardContent>
        </Card>
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
