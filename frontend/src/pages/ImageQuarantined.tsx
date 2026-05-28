import { useState, useEffect } from "react";
import { FolderX, RotateCcw, Trash2 } from "lucide-react";
import { imageApi, ImageFile } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function ImageQuarantined() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(new Set<number>());

  const load = () => {
    imageApi.listQuarantined(1, 10000).then((r) => {
      setImages(r.items);
      setTotal(r.total);
    }).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const toggle = (id: number) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectAll = () => setSelected(new Set(images.map((i) => i.id)));
  const selectNone = () => setSelected(new Set());

  async function restore(id: number) {
    await imageApi.restoreImage(id).catch((e: unknown) =>
      alert(e instanceof Error ? e.message : String(e))
    );
    load();
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  async function remove(id: number) {
    if (!confirm("Permanently delete this image?")) return;
    await imageApi.deleteImage(id).catch(() => {});
    load();
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  async function bulkDelete() {
    if (!confirm(`Permanently delete ${selected.size} images?`)) return;
    await Promise.all([...selected].map((id) => imageApi.deleteImage(id).catch(() => {})));
    selectNone();
    load();
  }

  async function bulkRestore() {
    await Promise.all([...selected].map((id) => imageApi.restoreImage(id).catch(() => {})));
    selectNone();
    load();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <FolderX className="h-5 w-5" style={{ color: "var(--px-accent)" }} />
        <div>
          <h1 className="text-lg font-semibold">Quarantined Images</h1>
          <p className="text-xs text-muted-foreground">{total} images in quarantine</p>
        </div>
      </div>

      {images.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <button onClick={selectAll} className="text-primary hover:underline">Select all</button>
          <span className="text-muted-foreground">·</span>
          <button onClick={selectNone} className="text-muted-foreground hover:underline">None</button>
          {selected.size > 0 && (
            <>
              <span className="text-muted-foreground ml-2">·</span>
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={bulkRestore}>
                <RotateCcw className="h-3 w-3" />
                Restore {selected.size}
              </Button>
              <Button size="sm" variant="destructive" className="h-6 text-xs" onClick={bulkDelete}>
                <Trash2 className="h-3 w-3" />
                Delete {selected.size}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {images.map((img) => (
          <div
            key={img.id}
            onClick={() => toggle(img.id)}
            className={`flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
              selected.has(img.id)
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-accent/50"
            }`}
          >
            {img.has_thumbnail && (
              <img src={imageApi.thumbnailUrl(img.id)} alt=""
                   className="h-10 w-10 rounded object-cover shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium">{img.filename}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{img.path}</p>
            </div>
            <p className="text-xs text-muted-foreground shrink-0">
              {(img.size / 1024).toFixed(0)} KB
            </p>
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => restore(img.id)}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => remove(img.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </div>
        ))}

        {images.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-16">
            No quarantined images.
          </p>
        )}
      </div>
    </div>
  );
}
