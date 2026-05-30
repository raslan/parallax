import { useState, useEffect, useMemo } from "react";
import { Check, Copy, FolderX, Loader2 } from "lucide-react";
import { imageApi, ImageFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { formatSize } from "@/lib/format";
import { SectionHeader } from "@/components/SectionHeader";

function recommendKeep(images: ImageFile[]): number {
  return images.reduce((best, img) => {
    const bScore = (best.width ?? 0) * (best.height ?? 0) || best.size;
    const iScore = (img.width ?? 0) * (img.height ?? 0) || img.size;
    return iScore > bScore ? img : best;
  }).id;
}

function ImageCard({
  img,
  isChecked,
  isSuggested,
  onToggle,
  onView,
}: {
  img: ImageFile;
  isChecked: boolean;
  isSuggested: boolean;
  onToggle: () => void;
  onView: () => void;
}) {
  return (
    <div
      onClick={onView}
      className={`relative cursor-pointer rounded-md overflow-hidden border w-36 h-36 transition-all shrink-0 ${
        isChecked
          ? "border-destructive/50 ring-1 ring-destructive/40"
          : "border-border hover:border-muted-foreground/50"
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

      {/* Checkbox top-left */}
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

      {/* Suggested keep badge top-right */}
      {isSuggested && (
        <div className="absolute top-1.5 right-1.5 bg-primary/90 text-primary-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded z-10">
          KEEP
        </div>
      )}

      {/* Filename + size overlay bottom */}
      <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-1">
        <p className="truncate text-[10px] text-white leading-tight">{img.filename}</p>
        <p className="text-[10px] text-white/60">{formatSize(img.size)}</p>
      </div>
    </div>
  );
}

function ClusterCard({
  images,
  suggestedKeepId,
  deleteIds,
  onToggle,
  onView,
}: {
  images: ImageFile[];
  suggestedKeepId: number;
  deleteIds: Set<number>;
  onToggle: (id: number) => void;
  onView: (img: ImageFile) => void;
}) {
  const checkedCount = images.filter((img) => deleteIds.has(img.id)).length;
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-normal text-muted-foreground">
          {images.length} copies
          {checkedCount > 0 && (
            <span className="ml-2 text-destructive">{checkedCount} selected for quarantine</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-wrap gap-3">
          {images.map((img) => (
            <ImageCard
              key={img.id}
              img={img}
              isChecked={deleteIds.has(img.id)}
              isSuggested={img.id === suggestedKeepId && !deleteIds.has(img.id)}
              onToggle={() => onToggle(img.id)}
              onView={() => onView(img)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ImageDuplicates({ libraryId }: { libraryId?: number } = {}) {
  const [clusters, setClusters] = useState<number[][]>([]);
  const [allImages, setAllImages] = useState<Map<number, ImageFile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [suggestedKeepIds, setSuggestedKeepIds] = useState<Record<number, number>>({});
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());
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

      const newKeepIds: Record<number, number> = {};
      const newDeleteIds = new Set<number>();
      clusterData.forEach((ids, i) => {
        const imgs = ids.map((id) => imgMap.get(id)).filter(Boolean) as ImageFile[];
        const keepId = recommendKeep(imgs);
        newKeepIds[i] = keepId;
        ids.forEach((id) => { if (id !== keepId) newDeleteIds.add(id); });
      });
      setSuggestedKeepIds(newKeepIds);
      setDeleteIds(newDeleteIds);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [libraryId]);

  const clusterImages = useMemo(() =>
    clusters.map((ids) => ids.map((id) => allImages.get(id)).filter(Boolean) as ImageFile[]),
    [clusters, allImages]
  );

  const toggleDelete = (id: number) => {
    setDeleteIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleQuarantine = async () => {
    if (!deleteIds.size) return;
    if (!confirm(`Quarantine ${deleteIds.size} image(s)?`)) return;
    setQuarantining(true);
    try {
      await imageApi.quarantineBulk([...deleteIds]);
      await load();
    } finally {
      setQuarantining(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionHeader className="mb-1.5">Duplicate detection</SectionHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Image Duplicates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Check images to quarantine, uncheck to keep. Click any image to preview.
          </p>
        </div>
        {!loading && clusters.length > 0 && (
          <Button
            variant="destructive"
            disabled={deleteIds.size === 0 || quarantining}
            onClick={handleQuarantine}
            className="shrink-0"
          >
            <FolderX className="h-4 w-4 mr-2" />
            {quarantining ? "Quarantining…" : `Quarantine ${deleteIds.size} Selected`}
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && clusters.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Copy className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No duplicates found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              No duplicate images found. Make sure you've scanned with Duplicates enabled.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && clusters.length > 0 && (
        <>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-sm">
              <span className="font-semibold tabular-nums font-mono">{clusters.length}</span> duplicate group{clusters.length !== 1 ? "s" : ""} found
              {deleteIds.size > 0 && (
                <span className="text-muted-foreground ml-2">
                  · <span className="font-mono font-semibold text-foreground">{deleteIds.size}</span> selected for quarantine
                </span>
              )}
            </p>
          </div>

          <div className="space-y-4">
            {clusters.map((_, i) => (
              <ClusterCard
                key={i}
                images={clusterImages[i] ?? []}
                suggestedKeepId={suggestedKeepIds[i]}
                deleteIds={deleteIds}
                onToggle={toggleDelete}
                onView={setViewingImg}
              />
            ))}
          </div>
        </>
      )}

      {viewingImg && (
        <ImageViewerModal img={viewingImg} onClose={() => setViewingImg(null)} />
      )}
    </div>
  );
}
