import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, Trash2, ShieldCheck, Play } from "lucide-react";
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
        <option key={lib.id} value={lib.id}>
          {lib.name}
        </option>
      ))}
    </select>
  );
}

function FilePanel({
  file,
  isKeep,
  onClick,
  onPlay,
}: {
  file: DuplicateFile;
  isKeep: boolean;
  onClick: () => void;
  onPlay: (f: DuplicateFile) => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex-1 min-w-[220px] rounded-lg border p-3 cursor-pointer transition-colors space-y-2 ${
        isKeep
          ? "border-primary/60 bg-primary/5"
          : "border-border hover:border-muted-foreground/40"
      }`}
    >
      <div className="relative aspect-video w-full rounded overflow-hidden bg-muted flex items-center justify-center group/thumb">
        {file.has_thumbnail ? (
          <img
            src={`/api/files/${file.id}/thumbnail`}
            alt={file.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <Copy className="h-6 w-6 text-muted-foreground" />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(file); }}
          title="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity"
        >
          <Play className="h-6 w-6 text-white fill-white" />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        {isKeep ? (
          <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">Keep</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Will delete</span>
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
  keepId,
  onFlip,
  onPlay,
}: {
  group: DuplicateGroup;
  keepId: number;
  onFlip: (fileId: number) => void;
  onPlay: (f: DuplicateFile) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground font-normal">
          {group.files.length} copies · {formatSize(group.files[0].size)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {group.files.map((f) => (
            <FilePanel
              key={f.id}
              file={f}
              isKeep={f.id === keepId}
              onClick={() => { if (f.id !== keepId) onFlip(f.id); }}
              onPlay={onPlay}
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
    if (stored) return JSON.parse(stored);
  } catch {}
  return { use_size: true, use_duration: true, use_phash: true, duration_tolerance: 1 };
}

export function Duplicates() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [keepIds, setKeepIds] = useState<Record<number, number>>({});
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
      if (attempts > 60) {
        stopPolling();
        setScanning(false);
        return;
      }
      try {
        const result = await api.getDuplicates(libraryId);
        setGroups(result);
        const init: Record<number, number> = {};
        result.forEach((g, i) => { init[i] = g.keep_id; });
        setKeepIds(init);
        stopPolling();
        setScanning(false);
      } catch (e: any) {
        if (!e?.message?.startsWith("404")) {
          stopPolling();
          setScanning(false);
        }
      }
    }, 2000);
  };

  const handleScan = async () => {
    if (!selectedId) return;
    stopPolling();
    setScanning(true);
    setGroups(null);
    setKeepIds({});
    try {
      await api.findDuplicates(selectedId, criteria);
    } catch {
      setScanning(false);
      return;
    }
    startPolling(selectedId);
  };

  const handleFlip = (groupIndex: number, fileId: number) => {
    setKeepIds((prev) => ({ ...prev, [groupIndex]: fileId }));
  };

  const handleDeleteAll = async () => {
    if (!selectedId || !groups) return;
    const toDelete = groups.flatMap((g, i) =>
      g.files.filter((f) => f.id !== (keepIds[i] ?? g.keep_id)).map((f) => f.id)
    );
    if (toDelete.length === 0) return;
    if (!confirm(`Move ${toDelete.length} file(s) to _originals/ and remove from library?`)) return;
    setDeleting(true);
    try {
      await api.deleteDuplicates(selectedId, toDelete);
      setGroups((prev) =>
        prev
          ?.map((g, i) => ({
            ...g,
            files: g.files.filter((f) => f.id === (keepIds[i] ?? g.keep_id)),
          }))
          .filter((g) => g.files.length > 1) ?? []
      );
    } finally {
      setDeleting(false);
    }
  };

  const recoverable = groups
    ? groups.reduce((sum, g, i) => {
        const keepId = keepIds[i] ?? g.keep_id;
        return sum + g.files.filter((f) => f.id !== keepId).reduce((s, f) => s + f.size, 0);
      }, 0)
    : 0;

  return (
    <div className="p-8 space-y-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SectionHeader className="mb-1.5">Duplicate detection</SectionHeader>
            <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Find videos matching the selected criteria.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {libraries.length > 0 && (
              <LibrarySelector
                libraries={libraries}
                selected={selectedId}
                onChange={(id) => { setSelectedId(id); setGroups(null); setKeepIds({}); }}
              />
            )}
            <Button
              onClick={handleScan}
              disabled={scanning || !selectedId || (!criteria.use_size && !criteria.use_duration && !criteria.use_phash)}
            >
              {scanning ? (
                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Scanning…</>
              ) : (
                <><ShieldCheck className="h-3.5 w-3.5 mr-2" />Scan for Duplicates</>
              )}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <SectionHeader>Match Criteria</SectionHeader>
          {(
            [
              { key: "use_size",     label: "Exact size" },
              { key: "use_duration", label: "Duration" },
              { key: "use_phash",    label: "Visual (pHash)" },
            ] as { key: keyof DuplicateCriteria; label: string }[]
          ).map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={criteria[key] as boolean}
                onChange={(e) => setCriteria((prev) => ({ ...prev, [key]: e.target.checked }))}
                className="accent-[var(--px-accent)] h-3.5 w-3.5"
              />
              <span className="text-sm text-muted-foreground">{label}</span>
            </label>
          ))}
          {criteria.use_duration && (
            <label className="flex items-center gap-1.5 select-none">
              <span className="text-sm text-muted-foreground">±</span>
              <input
                type="number"
                min={0}
                max={60}
                step={0.5}
                value={criteria.duration_tolerance}
                onChange={(e) => setCriteria((prev) => ({ ...prev, duration_tolerance: Math.max(0, Number(e.target.value)) }))}
                className="w-14 bg-card border border-border text-sm rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary tabular-nums"
              />
              <span className="text-sm text-muted-foreground">s</span>
            </label>
          )}
        </div>
      </div>

      {groups !== null && groups.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold tabular-nums font-mono">{groups.length}</span> duplicate group{groups.length !== 1 ? "s" : ""} found
            {recoverable > 0 && (
              <span className="text-muted-foreground ml-2">· {formatSize(recoverable)} recoverable</span>
            )}
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteAll}
            disabled={deleting}
          >
            {deleting ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Deleting…</>
            ) : (
              <><Trash2 className="h-3.5 w-3.5 mr-2" />Delete All Suggested</>
            )}
          </Button>
        </div>
      )}

      {scanning && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

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

      {!scanning && groups && groups.length > 0 && (
        <div className="space-y-4">
          {groups.map((group, i) => (
            <GroupCard
              key={i}
              group={group}
              keepId={keepIds[i] ?? group.keep_id}
              onFlip={(fileId) => handleFlip(i, fileId)}
              onPlay={setPlayingFile}
            />
          ))}
        </div>
      )}

      {!scanning && groups === null && !initializing && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Copy className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">Ready to scan</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Select a library and click Scan for Duplicates to find matching videos.
            </p>
          </CardContent>
        </Card>
      )}

      {playingFile && (
        <VideoPlayerModal file={playingFile} onClose={() => setPlayingFile(null)} />
      )}
    </div>
  );
}
