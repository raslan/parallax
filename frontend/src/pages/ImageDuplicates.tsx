import { useState, useEffect, useMemo } from "react";
import { Copy, FolderX, Check } from "lucide-react";
import { imageApi, ImageFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { formatSize } from "@/lib/format";

function recommendKeep(images: ImageFile[]): number {
  return images.reduce((best, img) => {
    const bScore = (best.width ?? 0) * (best.height ?? 0) || best.size;
    const iScore = (img.width ?? 0) * (img.height ?? 0) || img.size;
    return iScore > bScore ? img : best;
  }).id;
}

function ClusterCard({
  images,
  keepId,
  selectedIds,
  onFlipKeep,
  onToggle,
  onView,
}: {
  images: ImageFile[];
  keepId: number;
  selectedIds: Set<number>;
  onFlipKeep: (id: number) => void;
  onToggle: (id: number) => void;
  onView: (img: ImageFile) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-normal text-muted-foreground">
          {images.length} copies
          {" · "}
          <span className="text-foreground font-medium">
            {images.find((i) => i.id === keepId)?.filename ?? ""}
          </span>
          {" "}recommended to keep
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-wrap gap-3">
          {images.map((img) => {
            const isKeep = img.id === keepId;
            const isSelected = selectedIds.has(img.id);
            return (
              <div key={img.id} className="flex flex-col gap-1 items-center">
                <div
                  onClick={() => onView(img)}
                  className={`relative cursor-pointer rounded-md overflow-hidden border w-32 h-32 transition-all ${
                    isKeep
                      ? "ring-2 ring-green-500 border-green-500"
                      : isSelected
                      ? "ring-2 ring-primary border-primary"
                      : "border-border opacity-70"
                  }`}
                >
                  {img.has_thumbnail ? (
                    <img
                      src={imageApi.thumbnailUrl(img.id)}
                      alt={img.filename}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-muted" />
                  )}

                  {/* Keep badge */}
                  {isKeep && (
                    <div className="absolute top-1.5 right-1.5 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                      KEEP
                    </div>
                  )}

                  {/* Selection checkbox (non-keep only) */}
                  {!isKeep && (
                    <div
                      onClick={(e) => { e.stopPropagation(); onToggle(img.id); }}
                      className={`absolute top-1.5 left-1.5 h-5 w-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-primary border-primary"
                          : "bg-background/80 border-muted-foreground"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                  )}

                  <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5">
                    <p className="truncate text-[10px] text-white">{img.filename}</p>
                    <p className="text-[10px] text-white/60">{formatSize(img.size)}</p>
                  </div>
                </div>

                {/* "Make keep" button for non-keep images */}
                {!isKeep && (
                  <button
                    onClick={() => onFlipKeep(img.id)}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Set as keep
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function ImageDuplicates({ libraryId }: { libraryId?: number } = {}) {
  const [clusters, setClusters] = useState<number[][]>([]);
  const [allImages, setAllImages] = useState<Map<number, ImageFile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [keepIds, setKeepIds] = useState<Record<number, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [quarantining, setQuarantining] = useState(false);
  const [viewingImg, setViewingImg] = useState<ImageFile | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [clusterData, imageData] = await Promise.all([
        imageApi.duplicates(libraryId),
        imageApi.listImages({ library_id: libraryId, page: 1, page_size: 10000 }),
      ]);

      const imgMap = new Map<number, ImageFile>(imageData.items.map((img) => [img.id, img]));
      setAllImages(imgMap);
      setClusters(clusterData);

      // Compute keep IDs (largest resolution / size) and pre-select all others
      const newKeepIds: Record<number, number> = {};
      const newSelected = new Set<number>();
      clusterData.forEach((ids, i) => {
        const imgs = ids.map((id) => imgMap.get(id)).filter(Boolean) as ImageFile[];
        const keepId = recommendKeep(imgs);
        newKeepIds[i] = keepId;
        ids.forEach((id) => { if (id !== keepId) newSelected.add(id); });
      });
      setKeepIds(newKeepIds);
      setSelectedIds(newSelected);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [libraryId]);

  const clusterImages = useMemo(() =>
    clusters.map((ids) =>
      ids.map((id) => allImages.get(id)).filter(Boolean) as ImageFile[]
    ),
    [clusters, allImages]
  );

  const flipKeep = (clusterIdx: number, newKeepId: number) => {
    const oldKeepId = keepIds[clusterIdx];
    setKeepIds((prev) => ({ ...prev, [clusterIdx]: newKeepId }));
    // old keep becomes selectable (pre-select it), new keep deselects
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(oldKeepId);
      next.delete(newKeepId);
      return next;
    });
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleQuarantine = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Quarantine ${selectedIds.size} image(s)?`)) return;
    setQuarantining(true);
    try {
      await imageApi.quarantineBulk([...selectedIds]);
      await load();
    } finally {
      setQuarantining(false);
    }
  };

  const totalSelected = selectedIds.size;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Copy className="h-5 w-5" style={{ color: "var(--px-accent)" }} />
          <div>
            <h1 className="text-lg font-semibold">Image Duplicates</h1>
            <p className="text-xs text-muted-foreground">
              {loading
                ? "Scanning…"
                : `${clusters.length} duplicate group${clusters.length !== 1 ? "s" : ""} · ${totalSelected} image${totalSelected !== 1 ? "s" : ""} selected for quarantine`}
            </p>
          </div>
        </div>

        {!loading && clusters.length > 0 && (
          <Button
            variant="destructive"
            disabled={totalSelected === 0 || quarantining}
            onClick={handleQuarantine}
          >
            <FolderX className="h-4 w-4 mr-2" />
            {quarantining ? "Quarantining…" : `Quarantine ${totalSelected} Selected`}
          </Button>
        )}
      </div>

      {!loading && clusters.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-16">
          No duplicate images found. Make sure you've scanned with Duplicates enabled.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {clusters.map((ids, i) => (
          <ClusterCard
            key={i}
            images={clusterImages[i] ?? []}
            keepId={keepIds[i]}
            selectedIds={selectedIds}
            onFlipKeep={(id) => flipKeep(i, id)}
            onToggle={toggleSelected}
            onView={setViewingImg}
          />
        ))}
      </div>

      {viewingImg && (
        <ImageViewerModal img={viewingImg} onClose={() => setViewingImg(null)} />
      )}
    </div>
  );
}
