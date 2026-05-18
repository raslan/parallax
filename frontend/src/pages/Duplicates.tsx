import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, DuplicateGroup, Library } from "@/lib/api";
import { formatSize, formatDuration, formatBitrate } from "@/lib/format";

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
}: {
  file: DuplicateGroup["files"][0];
  isKeep: boolean;
  onClick: () => void;
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
      <div className="aspect-video w-full rounded overflow-hidden bg-muted flex items-center justify-center">
        {file.has_thumbnail ? (
          <img
            src={`/api/files/${file.id}/thumbnail`}
            alt={file.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <Copy className="h-6 w-6 text-muted-foreground" />
        )}
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
        <span>{formatSize(file.size)}</span>
        {file.duration != null && <span>{formatDuration(file.duration)}</span>}
        {file.video_bitrate != null && <span>{formatBitrate(file.video_bitrate)}</span>}
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
}: {
  group: DuplicateGroup;
  keepId: number;
  onFlip: (fileId: number) => void;
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
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function Duplicates() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [keepIds, setKeepIds] = useState<Record<number, number>>({});
  const [deleting, setDeleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.getLibraries().then((libs) => {
      setLibraries(libs);
      if (libs.length > 0) setSelectedId(libs[0].id);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleScan = async () => {
    if (!selectedId) return;
    stopPolling();
    setScanning(true);
    setGroups(null);
    setKeepIds({});
    try {
      await api.findDuplicates(selectedId);
    } catch {
      setScanning(false);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const result = await api.getDuplicates(selectedId);
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
        // 404 means scan not done yet — keep polling
      }
    }, 2000);
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Find videos with identical size, duration, and first frame.
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
          <Button onClick={handleScan} disabled={scanning || !selectedId}>
            {scanning ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Scanning…</>
            ) : (
              <><ShieldCheck className="h-3.5 w-3.5 mr-2" />Scan for Duplicates</>
            )}
          </Button>
        </div>
      </div>

      {groups !== null && groups.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{groups.length}</span> duplicate group{groups.length !== 1 ? "s" : ""} found
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
            />
          ))}
        </div>
      )}

      {!scanning && groups === null && (
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
    </div>
  );
}
