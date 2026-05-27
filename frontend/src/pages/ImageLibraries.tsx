import { useState, useEffect, useRef } from "react";
import { Images, Library, Plus, Trash2, ScanLine, FolderOpen, Loader2 } from "lucide-react";
import { imageApi, ImageLibrary, ImageScanRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { SectionHeader } from "@/components/SectionHeader";
import { DirPicker } from "@/components/DirPicker";
import { formatDate } from "@/lib/format";

const DEFAULT_SCAN_OPTS: ImageScanRequest = {
  run_phash: true,
  run_nudenet: true,
  run_siglip: true,
};

function AddImageLibraryDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (lib: ImageLibrary) => void;
}) {
  const [path, setPath] = useState("");
  const [scanOpts, setScanOpts] = useState<ImageScanRequest>(DEFAULT_SCAN_OPTS);
  const [autoScan, setAutoScan] = useState(true);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setPath(""); setScanOpts(DEFAULT_SCAN_OPTS); setAutoScan(true);
    setPicking(false); setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    setLoading(true);
    setError("");
    try {
      const lib = await imageApi.createLibrary({ path: path.trim() });
      if (autoScan) {
        await imageApi.scanLibrary(lib.id, scanOpts).catch(() => {});
      }
      reset();
      onOpenChange(false);
      onCreated(lib);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create library");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Add Image Library</DialogTitle>
        </DialogHeader>
        {picking ? (
          <DirPicker
            onSelect={(p) => { setPath(p); setPicking(false); }}
            onClose={() => setPicking(false)}
          />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Path</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="/media/photos"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className="font-mono text-sm"
                  required
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setPicking(true)} title="Browse">
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Scan options</Label>
              {([
                ["run_phash", "Duplicates (pHash)"],
                ["run_nudenet", "Content review (NudeNet)"],
                ["run_siglip", "Semantic search (SigLIP)"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={scanOpts[key]}
                    onChange={(e) => setScanOpts((o) => ({ ...o, [key]: e.target.checked }))}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoScan}
                onChange={(e) => setAutoScan(e.target.checked)}
                className="accent-primary h-4 w-4 mt-0.5 shrink-0"
              />
              <div>
                <p className="text-sm font-medium">Scan after creation</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automatically index and analyse images as soon as the library is created.
                </p>
              </div>
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={loading || !path.trim()}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add Library
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ImageLibraries() {
  const [libraries, setLibraries] = useState<ImageLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanningIds, setScanningIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scanOptsFor, setScanOptsFor] = useState<number | null>(null);
  const [scanOpts, setScanOpts] = useState<ImageScanRequest>(DEFAULT_SCAN_OPTS);
  const scanOptsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scanOptsFor === null) return;
    const handler = (e: MouseEvent) => {
      if (scanOptsRef.current && !scanOptsRef.current.contains(e.target as Node)) {
        setScanOptsFor(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [scanOptsFor]);

  const load = () => {
    setLoading(true);
    imageApi.listLibraries().then(setLibraries).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleScan = async (id: number) => {
    setScanOptsFor(null);
    setScanningIds((s) => new Set(s).add(id));
    try {
      await imageApi.scanLibrary(id, scanOpts);
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message?.includes("409"))) throw e;
    } finally {
      setScanningIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this image library and remove all its records? Files on disk are not touched.")) return;
    setDeletingIds((s) => new Set(s).add(id));
    try {
      await imageApi.deleteLibrary(id);
      setLibraries((prev) => prev.filter((l) => l.id !== id));
    } finally {
      setDeletingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const totalImages = libraries.reduce((s, l) => s + l.image_count, 0);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <SectionHeader className="mb-1.5">Image collection</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Image Libraries</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalImages > 0
              ? `${libraries.length} ${libraries.length === 1 ? "library" : "libraries"} · ${totalImages.toLocaleString()} images`
              : "Add folders to scan for images."}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Library
        </Button>
      </div>

      <AddImageLibraryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(lib) => setLibraries((prev) => [...prev, lib])}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : libraries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Images className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No image libraries</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add a folder to start scanning and analysing your images.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {libraries.map((lib) => (
            <Card key={lib.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight">{lib.name}</CardTitle>
                  <div className="flex gap-1 shrink-0 items-center relative">
                    <div className="relative" ref={scanOptsFor === lib.id ? scanOptsRef : undefined}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={scanningIds.has(lib.id)}
                        title="Scan for images"
                        onClick={() => setScanOptsFor((v) => v === lib.id ? null : lib.id)}
                      >
                        <ScanLine className={`h-3.5 w-3.5 ${scanningIds.has(lib.id) ? "text-primary animate-pulse" : ""}`} />
                      </Button>
                      {scanOptsFor === lib.id && (
                        <div className="absolute right-0 top-8 z-10 bg-card border border-border rounded-lg shadow-lg p-3 flex flex-col gap-2 min-w-[200px]">
                          {([
                            ["run_phash", "Duplicates (pHash)"],
                            ["run_nudenet", "Content review (NudeNet)"],
                            ["run_siglip", "Semantic search (SigLIP)"],
                          ] as const).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={scanOpts[key]}
                                onChange={(e) => setScanOpts((o) => ({ ...o, [key]: e.target.checked }))}
                                className="h-3.5 w-3.5 accent-primary"
                              />
                              <span className="text-xs">{label}</span>
                            </label>
                          ))}
                          <Button size="sm" className="mt-1" onClick={() => handleScan(lib.id)}>
                            Scan
                          </Button>
                        </div>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      disabled={deletingIds.has(lib.id)}
                      title="Delete library"
                      onClick={() => handleDelete(lib.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-mono">{lib.path}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Library className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    {lib.image_count > 0
                      ? <><span className="font-mono">{lib.image_count.toLocaleString()}</span> images</>
                      : "No images indexed"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {lib.last_scanned_at
                    ? `Last scanned: ${formatDate(lib.last_scanned_at)}`
                    : "Not yet scanned — click the scan icon to index images"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
