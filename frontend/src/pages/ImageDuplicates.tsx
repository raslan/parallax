import { useState, useEffect } from "react";
import { Copy, FolderX } from "lucide-react";
import { imageApi, ImageFile } from "@/lib/api";
import { Button } from "@/components/ui/button";

function DuplicateCluster({ ids, onQuarantine }: { ids: number[]; onQuarantine: (id: number) => void }) {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    imageApi.listImages({ page: 1, page_size: 200 }).then((r) => {
      setImages(r.items.filter((img) => ids.includes(img.id)));
    });
  }, [ids]);

  const toggle = (id: number) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap gap-3">
        {images.map((img) => (
          <div
            key={img.id}
            onClick={() => toggle(img.id)}
            className={`relative cursor-pointer rounded-md overflow-hidden border w-32 h-32 ${
              selected.has(img.id) ? "ring-2 ring-primary border-primary" : "border-border"
            }`}
          >
            {img.has_thumbnail ? (
              <img src={imageApi.thumbnailUrl(img.id)} alt={img.filename}
                   className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-muted" />
            )}
            <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5">
              <p className="truncate text-[10px] text-white">{img.filename}</p>
              <p className="text-[10px] text-white/60">{(img.size / 1024).toFixed(0)} KB</p>
            </div>
          </div>
        ))}
      </div>
      {selected.size > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <Button size="sm" variant="destructive"
                  onClick={() => { selected.forEach((id) => onQuarantine(id)); setSelected(new Set()); }}>
            <FolderX className="h-3.5 w-3.5" />
            Quarantine Selected
          </Button>
        </div>
      )}
    </div>
  );
}

export function ImageDuplicates() {
  const [clusters, setClusters] = useState<number[][]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    imageApi.duplicates().then(setClusters).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  async function quarantine(id: number) {
    await imageApi.quarantineImage(id).catch(() => {});
    load();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Copy className="h-5 w-5" style={{ color: "var(--px-accent)" }} />
        <div>
          <h1 className="text-lg font-semibold">Image Duplicates</h1>
          <p className="text-xs text-muted-foreground">
            {loading ? "Scanning…" : `${clusters.length} duplicate groups found`}
          </p>
        </div>
      </div>

      {!loading && clusters.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-16">
          No duplicate images found. Make sure you've scanned with Duplicates enabled.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {clusters.map((ids, i) => (
          <DuplicateCluster key={i} ids={ids} onQuarantine={quarantine} />
        ))}
      </div>
    </div>
  );
}
