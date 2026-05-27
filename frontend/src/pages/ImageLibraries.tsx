import { useState, useEffect } from "react";
import { Library, Plus, Trash2, ScanLine, Images } from "lucide-react";
import { imageApi, ImageLibrary, ImageScanRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ImageLibraries() {
  const [libraries, setLibraries] = useState<ImageLibrary[]>([]);
  const [newPath, setNewPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [scanOpts, setScanOpts] = useState<ImageScanRequest>({
    run_phash: true,
    run_nudenet: true,
    run_siglip: true,
  });

  const load = () => imageApi.listLibraries().then(setLibraries).catch(() => {});

  useEffect(() => { load(); }, []);

  async function addLibrary() {
    if (!newPath.trim()) return;
    setAdding(true);
    try {
      await imageApi.createLibrary({ path: newPath.trim() });
      setNewPath("");
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  async function deleteLibrary(id: number) {
    if (!confirm("Remove this image library?")) return;
    await imageApi.deleteLibrary(id).catch(() => {});
    await load();
  }

  async function scanLibrary(id: number) {
    await imageApi.scanLibrary(id, scanOpts).catch((e: unknown) =>
      alert(e instanceof Error ? e.message : String(e))
    );
  }

  const totalImages = libraries.reduce((s, l) => s + l.image_count, 0);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Images className="h-5 w-5" style={{ color: "var(--px-accent)" }} />
        <div>
          <h1 className="text-lg font-semibold">Image Libraries</h1>
          <p className="text-xs text-muted-foreground">Add folders to scan for images.</p>
        </div>
      </div>

      <div
        className="flex gap-6 rounded-[0.4rem] p-4"
        style={{ border: "1px solid var(--px-accent-border)", background: "var(--px-accent-dim)" }}
      >
        <div>
          <p className="text-2xl font-semibold">{libraries.length}</p>
          <p className="text-xs text-muted-foreground">Libraries</p>
        </div>
        <div>
          <p className="text-2xl font-semibold">{totalImages}</p>
          <p className="text-xs text-muted-foreground">Total Images</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Add Library
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="/media/photos"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLibrary()}
            className="flex-1 font-mono text-sm"
          />
          <Button size="sm" onClick={addLibrary} disabled={adding || !newPath.trim()}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Scan Options
        </p>
        <div className="flex flex-col gap-2">
          {([
            ["run_phash", "Duplicates (pHash)"],
            ["run_nudenet", "Content Review (NudeNet)"],
            ["run_siglip", "Semantic Search (SigLIP)"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scanOpts[key]}
                onChange={(e) => setScanOpts(o => ({ ...o, [key]: e.target.checked }))}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {libraries.map((lib) => (
          <div key={lib.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <Library className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{lib.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{lib.path}</p>
            </div>
            <span className="text-xs text-muted-foreground">{lib.image_count} images</span>
            <Button size="sm" variant="outline" onClick={() => scanLibrary(lib.id)}>
              <ScanLine className="h-3.5 w-3.5" />
              Scan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => deleteLibrary(lib.id)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
        {libraries.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            No image libraries yet. Add a folder above.
          </p>
        )}
      </div>
    </div>
  );
}
