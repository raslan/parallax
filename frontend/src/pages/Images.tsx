import { useState, useEffect, useCallback } from "react";
import { Images as ImagesIcon, FolderX, ChevronLeft, ChevronRight } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { imageApi, ImageFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatSize } from "@/lib/format";
import { ImageViewerModal } from "@/components/ImageViewerModal";

const SORT_OPTIONS = [
  { value: "filename", label: "Name" },
  { value: "size", label: "Size" },
  { value: "date", label: "Date" },
  { value: "width", label: "Width" },
];

const PAGE_SIZE = 60;

function ImageCard({
  img, selectionMode, selected, onToggle, onQuarantine, onOpen,
}: {
  img: ImageFile;
  selectionMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onQuarantine: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={`relative group rounded-md overflow-hidden border cursor-pointer transition-all ${
        selected ? "ring-2 ring-primary border-primary" : "border-border"
      }`}
      onClick={() => { if (selectionMode) onToggle(); else onOpen(); }}
    >
      {img.has_thumbnail ? (
        <img
          src={imageApi.thumbnailUrl(img.id)}
          alt={img.filename}
          className="w-full aspect-square object-cover bg-muted"
        />
      ) : (
        <div className="w-full aspect-square bg-muted flex items-center justify-center">
          <ImagesIcon className="h-8 w-8 text-muted-foreground/40" />
        </div>
      )}

      {selectionMode && (
        <div className={`absolute top-1.5 left-1.5 h-5 w-5 rounded border-2 flex items-center justify-center ${
          selected ? "bg-primary border-primary" : "bg-background/80 border-muted-foreground"
        }`}>
          {selected && <span className="text-[10px] text-primary-foreground font-bold">✓</span>}
        </div>
      )}

      {img.detections.length > 0 && (
        <div className="absolute top-1.5 right-1.5 rounded bg-destructive/90 px-1 py-0.5 text-[10px] text-white font-medium">
          {img.detections.length}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="truncate text-[11px] text-white">{img.filename}</p>
        {!selectionMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onQuarantine(); }}
            className="mt-1 text-[10px] text-white/70 hover:text-white"
          >
            Quarantine
          </button>
        )}
      </div>
    </div>
  );
}

export function Images() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("filename");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = useState("");
  const [detectionFilter, setDetectionFilter] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set<number>());
  const [quarantining, setQuarantining] = useState(false);
  const [viewingImg, setViewingImg] = useState<ImageFile | null>(null);

  const load = useCallback(() => {
    imageApi.listImages({
      page,
      page_size: PAGE_SIZE,
      sort_by: sortBy,
      sort_dir: sortDir,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(detectionFilter ? { has_detections: detectionFilter as "any" | "exposed" | "none" } : {}),
    }).then((r) => {
      setImages(r.items);
      setTotal(r.total);
    }).catch(() => {});
  }, [page, sortBy, sortDir, statusFilter, detectionFilter]);

  useEffect(() => { load(); }, [load]);

  const toggleId = (id: number) =>
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSelectionMode = () => {
    setSelectionMode((m) => !m);
    setSelectedIds(new Set());
  };

  async function quarantineSelected() {
    if (!selectedIds.size) return;
    setQuarantining(true);
    try {
      await imageApi.quarantineBulk([...selectedIds]);
      setSelectedIds(new Set());
      setSelectionMode(false);
      load();
    } finally {
      setQuarantining(false);
    }
  }

  async function quarantineOne(id: number) {
    await imageApi.quarantineImage(id).catch(() => {});
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <SectionHeader className="mb-1.5">Images</SectionHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Images</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse and manage images across all libraries.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}
        >
          {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
        </Button>

        <select
          value={statusFilter || "all"}
          onChange={(e) => setStatusFilter(e.target.value === "all" ? "" : e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="all">All Status</option>
          <option value="scanned">Scanned</option>
          <option value="failed">Failed</option>
        </select>

        <select
          value={detectionFilter || "all"}
          onChange={(e) => setDetectionFilter(e.target.value === "all" ? "" : e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="all">All Images</option>
          <option value="any">Has Detections</option>
          <option value="exposed">Exposed Only</option>
          <option value="none">No Detections</option>
        </select>

        <button
          onClick={toggleSelectionMode}
          className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors ml-auto ${
            selectionMode
              ? "bg-primary text-primary-foreground border-primary"
              : "border-input text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <FolderX className="h-3.5 w-3.5" />
          Select
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {images.map((img) => (
          <ImageCard
            key={img.id}
            img={img}
            selectionMode={selectionMode}
            selected={selectedIds.has(img.id)}
            onToggle={() => toggleId(img.id)}
            onQuarantine={() => quarantineOne(img.id)}
            onOpen={() => setViewingImg(img)}
          />
        ))}
      </div>

      {images.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ImagesIcon className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No images found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Add an image library and run a scan to populate this view.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {selectionMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-3 shadow-xl">
          {selectedIds.size === 0 ? (
            <span className="text-sm text-muted-foreground">Click images to select</span>
          ) : (
            <>
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Button size="sm" variant="destructive" disabled={quarantining} onClick={quarantineSelected}>
                <FolderX className="h-3.5 w-3.5" />
                Quarantine
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={toggleSelectionMode}>Cancel</Button>
        </div>
      )}

      {viewingImg && (
        <ImageViewerModal img={viewingImg} onClose={() => setViewingImg(null)} />
      )}
    </div>
  );
}
