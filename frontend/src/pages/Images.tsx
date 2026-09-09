import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Images as ImagesIcon, FolderX, ArrowUp, ArrowDown, Search } from "lucide-react";
import { imageApi, qk } from "@/lib/api";
import type { ImageFile } from "@/types/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { useLiveFiles } from "@/hooks/useLiveFiles";
import { useSelection } from "@/hooks/useSelection";
import { useSort } from "@/hooks/useSort";
import { filterByFilename } from "@/components/FileSelectGrid";
import { VirtualizedGrid } from "@/components/VirtualizedGrid";
import { GridSizeControl } from "@/components/GridSizeControl";
import { useGridSize } from "@/hooks/useGridSize";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SORT_OPTIONS = [
  { value: "filename", label: "Name" },
  { value: "size", label: "Size" },
  { value: "date", label: "Date" },
  { value: "width", label: "Width" },
];

const FETCH_ALL_PAGE_SIZE = 10000;

function ImageCard({
  img,
  selectionMode,
  selected,
  onToggle,
  onQuarantine,
  onOpen,
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
      onClick={() => {
        if (selectionMode) onToggle();
        else onOpen();
      }}
    >
      {img.has_thumbnail ? (
        <img
          src={imageApi.thumbnailUrl(img.id, img.scanned_at ?? undefined)}
          alt={img.filename}
          className="w-full aspect-square object-cover bg-muted"
        />
      ) : (
        <div className="w-full aspect-square bg-muted flex items-center justify-center">
          <ImagesIcon className="h-8 w-8 text-muted-foreground/40" />
        </div>
      )}

      {selectionMode && (
        <div
          className={`absolute top-1.5 left-1.5 h-5 w-5 rounded border-2 flex items-center justify-center ${
            selected ? "bg-primary border-primary" : "bg-background/80 border-muted-foreground"
          }`}
        >
          {selected && <span className="text-[10px] text-primary-foreground font-bold">✓</span>}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="truncate text-[11px] text-white">{img.filename}</p>
        {!selectionMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuarantine();
            }}
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
  const queryClient = useQueryClient();
  const [gridSize, setGridSize] = useGridSize(140);
  const {
    sortKey: sortBy,
    setSortKey: setSortBy,
    sortDir,
    setSortDir,
  } = useSort<string>("filename");
  const [statusFilter, setStatusFilter] = useState("");
  const [detectionFilter, setDetectionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const { selected: selectedIds, setSelected: setSelectedIds, toggle: toggleId } = useSelection();
  const [quarantining, setQuarantining] = useState(false);
  const [viewingImg, setViewingImg] = useState<ImageFile | null>(null);

  const { data } = useQuery({
    queryKey: qk.images({ sortBy, sortDir, statusFilter, detectionFilter }),
    queryFn: () =>
      imageApi.listImages({
        page: 1,
        page_size: FETCH_ALL_PAGE_SIZE,
        sort_by: sortBy,
        sort_dir: sortDir,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(detectionFilter
          ? { has_detections: detectionFilter as "any" | "exposed" | "none" }
          : {}),
      }),
  });
  const images = data?.items ?? [];
  const total = data?.total ?? 0;

  const reload = () => queryClient.invalidateQueries({ queryKey: qk.images() });

  useLiveFiles("image", null, reload);

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
      reload();
    } finally {
      setQuarantining(false);
    }
  }

  async function quarantineOne(id: number) {
    await imageApi.quarantineImage(id).catch(() => {});
    reload();
  }

  const visibleImages = filterByFilename(images, search);

  return (
    <div className="p-4 md:p-8 space-y-6 h-full flex flex-col">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Images</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and manage images across all libraries.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Select
          value={statusFilter || "all"}
          onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="h-8 w-[8.5rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="scanned">Scanned</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={detectionFilter || "all"}
          onValueChange={(v) => setDetectionFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="h-8 w-[9rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All images</SelectItem>
            <SelectItem value="any">Has detections</SelectItem>
            <SelectItem value="exposed">Exposed only</SelectItem>
            <SelectItem value="none">No detections</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search images…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-7 pr-3 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring w-44"
          />
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-8 w-[9rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={toggleSelectionMode}
            className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors ${
              selectionMode
                ? "bg-primary text-primary-foreground border-primary"
                : "border-input text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            <FolderX className="h-3.5 w-3.5" />
            Select
          </button>
          <GridSizeControl value={gridSize} onChange={setGridSize} />
        </div>
      </div>

      {total > images.length && (
        <p className="text-xs text-muted-foreground shrink-0">
          Showing first {images.length.toLocaleString()} of {total.toLocaleString()} images — narrow
          your filter to see more.
        </p>
      )}

      {visibleImages.length > 0 && (
        <div className="flex-1 min-h-0">
          <VirtualizedGrid
            items={visibleImages}
            getKey={(img) => img.id}
            mode="grid"
            itemHeight={140}
            itemAspectRatio={1}
            minColumnWidth={gridSize}
            gap={8}
            resetKey={`${statusFilter}-${detectionFilter}-${sortBy}-${sortDir}-${search}-${gridSize}`}
            renderItem={(img) => (
              <ImageCard
                img={img}
                selectionMode={selectionMode}
                selected={selectedIds.has(img.id)}
                onToggle={() => toggleId(img.id)}
                onQuarantine={() => quarantineOne(img.id)}
                onOpen={() => setViewingImg(img)}
              />
            )}
          />
        </div>
      )}

      {visibleImages.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ImagesIcon className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-1">No images found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add an image library and run a scan to populate this view.
            </p>
          </CardContent>
        </Card>
      )}

      {selectionMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-3 shadow-xl">
          {selectedIds.size === 0 ? (
            <span className="text-sm text-muted-foreground">Click images to select</span>
          ) : (
            <>
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={quarantining}
                onClick={quarantineSelected}
              >
                <FolderX className="h-3.5 w-3.5" />
                Quarantine
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={toggleSelectionMode}>
            Cancel
          </Button>
        </div>
      )}

      {viewingImg && <ImageViewerModal img={viewingImg} onClose={() => setViewingImg(null)} />}
    </div>
  );
}
