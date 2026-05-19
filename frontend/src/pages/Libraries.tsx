import { useEffect, useState, useRef } from "react";
import { Library as LibIcon, Loader2, RefreshCw, Trash2, Plus, FolderOpen, ShieldCheck, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { api, Library } from "@/lib/api";
import { PRESETS } from "@/lib/presets";
import { formatDate } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";

function AddLibraryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [scanAuto, setScanAuto] = useState(false);
  const [autoTranscode, setAutoTranscode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setName(""); setPath(""); setScanAuto(false); setAutoTranscode(false); setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    setLoading(true);
    setError("");
    try {
      await api.createLibrary({ name: name.trim(), path: path.trim(), scan_automatically: scanAuto, auto_transcode_corrupt: autoTranscode });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      setError(err.message || "Failed to create library");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Add Library</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="lib-name">Name</Label>
            <Input
              id="lib-name"
              placeholder="My Movies"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lib-path">Path</Label>
            <Input
              id="lib-path"
              placeholder="/media/movies"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Must be a path mounted inside the container (e.g. via volumes in docker-compose.yml).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={scanAuto} onChange={(e) => setScanAuto(e.target.checked)} className="accent-primary" />
              Scan automatically on a schedule
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={autoTranscode} onChange={(e) => setAutoTranscode(e.target.checked)} className="accent-primary" />
              Auto-transcode corrupt files after scan
            </label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Library
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Libraries() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanningIds, setScanningIds] = useState<Set<number>>(new Set());
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());
  const [transcodingIds, setTranscodingIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [transcodePresetFor, setTranscodePresetFor] = useState<number | null>(null);
  const presetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcodePresetFor === null) return;
    const handler = (e: MouseEvent) => {
      if (presetRef.current && !presetRef.current.contains(e.target as Node)) {
        setTranscodePresetFor(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [transcodePresetFor]);

  const load = () => {
    setLoading(true);
    api.getLibraries()
      .then(setLibraries)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleScan = async (id: number) => {
    setScanningIds((s) => new Set(s).add(id));
    try {
      await api.scanLibrary(id);
    } catch (e: any) {
      if (!e.message?.includes("409")) throw e; // ignore "already running"
    } finally {
      setScanningIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const handleCheck = async (id: number) => {
    setCheckingIds((s) => new Set(s).add(id));
    try {
      await api.checkLibrary(id);
    } catch (e: any) {
      if (!e.message?.includes("409")) throw e;
    } finally {
      setCheckingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const handleTranscode = async (id: number, preset: string) => {
    setTranscodePresetFor(null);
    setTranscodingIds((s) => new Set(s).add(id));
    try {
      await api.transcodeLibrary(id, preset);
    } catch (e: any) {
      if (!e.message?.includes("409")) throw e;
    } finally {
      setTranscodingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this library and remove all its file records? Files on disk are not touched.")) return;
    setDeletingIds((s) => new Set(s).add(id));
    try {
      await api.deleteLibrary(id);
      setLibraries((prev) => prev.filter((l) => l.id !== id));
    } finally {
      setDeletingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Libraries</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage the folders you want to scan and transcode.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Library
        </Button>
      </div>

      <AddLibraryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={load}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : libraries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <LibIcon className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No libraries</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add a folder from your mounted volumes to start scanning.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {libraries.map((lib) => {
            const notIndexed = lib.file_count === 0;
            const noCorrupt = lib.corrupt_count === 0;
            const checkTitle = notIndexed
              ? "Scan the library first to index files before checking for corruption"
              : "Check all indexed files for corruption";
            const transcodeTitle = notIndexed
              ? "Scan and check the library first"
              : noCorrupt
              ? "No corrupt files to transcode"
              : "Transcode all corrupt files";
            const transcodeDisabled = transcodingIds.has(lib.id) || notIndexed || noCorrupt;
            return (
            <Card key={lib.id} className={lib.corrupt_count > 0 ? "border-destructive/40" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">{lib.name}</CardTitle>
                  <div className="flex gap-1 shrink-0 items-center relative">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleScan(lib.id)}
                      disabled={scanningIds.has(lib.id)}
                      title="Scan for new / removed files"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${scanningIds.has(lib.id) ? "animate-spin" : ""}`} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleCheck(lib.id)}
                      disabled={checkingIds.has(lib.id) || notIndexed}
                      title={checkTitle}
                    >
                      <ShieldCheck className={`h-3.5 w-3.5 ${checkingIds.has(lib.id) ? "text-primary" : notIndexed ? "opacity-30" : ""}`} />
                    </Button>
                    <div className="relative" ref={transcodePresetFor === lib.id ? presetRef : undefined}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={transcodeDisabled}
                        title={transcodeTitle}
                        onClick={() => setTranscodePresetFor((v) => v === lib.id ? null : lib.id)}
                      >
                        <Wand2 className={`h-3.5 w-3.5 ${transcodingIds.has(lib.id) ? "text-primary animate-pulse" : transcodeDisabled ? "opacity-30" : ""}`} />
                      </Button>
                      {transcodePresetFor === lib.id && (
                        <div className="absolute right-0 top-8 z-10 bg-card border border-border rounded-lg shadow-lg p-1 flex flex-col gap-0.5 min-w-[110px]">
                          {PRESETS.map((p) => (
                            <button
                              key={p.value}
                              title={p.title}
                              onClick={() => handleTranscode(lib.id, p.value)}
                              className="text-left px-2.5 py-1.5 text-xs rounded hover:bg-accent transition-colors"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(lib.id)}
                      disabled={deletingIds.has(lib.id)}
                      title="Delete library"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{lib.path}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {lib.file_count > 0 && (
                    <span className="text-xs text-muted-foreground">
                      <span className="font-mono">{lib.file_count.toLocaleString()}</span> files
                      {lib.corrupt_count > 0 && (
                        <span className="text-destructive ml-1">· <span className="font-mono">{lib.corrupt_count}</span> corrupt</span>
                      )}
                    </span>
                  )}
                  {lib.scan_automatically && (
                    <Badge variant="secondary" className="text-xs">Auto-scan</Badge>
                  )}
                  {lib.auto_transcode_corrupt && (
                    <Badge variant="secondary" className="text-xs">Auto-transcode</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {notIndexed
                    ? "Not yet scanned — click the refresh icon to index files"
                    : `Last scanned: ${formatDate(lib.last_scanned_at)}`}
                </p>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
