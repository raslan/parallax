import { useMemo, useState } from "react";
import { ShieldAlert, Search, FolderX } from "lucide-react";
import { imageApi } from "@/lib/api";
import type { ImageFile } from "@/types/image";
import { Button } from "@/components/ui/button";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { useSelection } from "@/hooks/useSelection";
import { useQueryBuilder } from "@/hooks/useQueryBuilder";
import { QueryBuilder } from "@/components/QueryBuilder";
import { contentReviewFields, CLIP_SEARCH_FIELD_KEY } from "@/lib/contentReviewFields";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function ImageGrid({
  images,
  selectedIds,
  onToggle,
  onOpen,
}: {
  images: ImageFile[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onOpen: (img: ImageFile) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {images.map((img) => (
        <div
          key={img.id}
          onClick={() => onOpen(img)}
          className={`relative cursor-pointer rounded-md overflow-hidden border aspect-square ${
            selectedIds.has(img.id) ? "ring-2 ring-primary border-primary" : "border-border"
          }`}
        >
          {img.has_thumbnail ? (
            <img
              src={imageApi.thumbnailUrl(img.id, img.scanned_at ?? undefined)}
              alt={img.filename}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-muted" />
          )}
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggle(img.id);
            }}
            className={`absolute top-1.5 left-1.5 h-5 w-5 rounded border-2 flex items-center justify-center cursor-pointer ${
              selectedIds.has(img.id)
                ? "bg-primary border-primary"
                : "bg-background/80 border-muted-foreground"
            }`}
          >
            {selectedIds.has(img.id) && (
              <span className="text-[10px] text-primary-foreground font-bold">✓</span>
            )}
          </div>
          {img.detections.length > 0 && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="absolute top-1 right-1 rounded bg-destructive/90 px-1 py-0.5 text-[10px] text-white cursor-default">
                    {img.detections.length}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[220px]">
                  <div className="space-y-0.5">
                    {img.detections.map((d) => (
                      <div key={d.id} className="flex justify-between gap-3">
                        <span className="text-muted-foreground truncate">
                          {d.label.replace(/_/g, " ").toLowerCase()}
                        </span>
                        <span className="font-mono tabular-nums shrink-0">
                          {(d.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      ))}
    </div>
  );
}

export function ContentReview() {
  const [allImages, setAllImages] = useState<ImageFile[] | null>(null);
  const { clauses, fieldsByKey, addClause, removeClause, updateClause, evaluate } =
    useQueryBuilder(contentReviewFields);
  const { selected: selectedIds, setSelected: setSelectedIds, toggle: toggleId } = useSelection();
  const [loading, setLoading] = useState(false);
  const [quarantining, setQuarantining] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [viewingImg, setViewingImg] = useState<ImageFile | null>(null);
  const [scoreMaps, setScoreMaps] = useState<Record<string, Map<number, number>>>({});
  const [error, setError] = useState<string | null>(null);

  async function runFilters() {
    setLoading(true);
    setSelectedIds(new Set());
    setHasRun(true);
    setError(null);
    try {
      const images = allImages ?? (await imageApi.listImages({ page_size: 10000 })).items;
      setAllImages(images);

      // Resolve every semantic-search clause into a score map keyed by clause.id,
      // deduped by query text so identical queries across clauses share one call.
      const searchClauses = clauses.filter((c) => c.fieldKey === CLIP_SEARCH_FIELD_KEY);
      const textToClauseIds = new Map<string, string[]>();
      for (const c of searchClauses) {
        const text = (c.value as { text: string }).text.trim();
        if (!text) continue;
        textToClauseIds.set(text, [...(textToClauseIds.get(text) ?? []), c.id]);
      }

      const maps: Record<string, Map<number, number>> = {};
      await Promise.all(
        [...textToClauseIds.entries()].map(async ([text, clauseIds]) => {
          try {
            const results = await imageApi.searchImages(text, { limit: 100000 });
            const scoreMap = new Map(results.map((r) => [r.image.id, r.score]));
            for (const id of clauseIds) maps[id] = scoreMap;
          } catch {
            // fail open — leave no entry for these clause ids, evaluateClauses
            // treats a missing score map as always-true for that clause.
          }
        }),
      );

      setScoreMaps(maps);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to run filters";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const allResults = useMemo(
    () => (allImages ? allImages.filter((img) => evaluate(img, scoreMaps)) : []),
    [allImages, evaluate, scoreMaps],
  );

  async function quarantineSelected() {
    if (!selectedIds.size) return;
    setQuarantining(true);
    setError(null);
    try {
      await imageApi.quarantineBulk([...selectedIds]);
      setSelectedIds(new Set());
      setAllImages(null); // force a real refetch — GET /images excludes quarantined images
      await runFilters();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to quarantine selected images";
      setError(message);
    } finally {
      setQuarantining(false);
    }
  }

  const canRun = clauses.length > 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-5 w-5" style={{ color: "var(--px-accent)" }} />
        <div>
          <h1 className="text-lg font-semibold">Content Review</h1>
          <p className="text-xs text-muted-foreground">
            Compose a query from detection labels and semantic search.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <QueryBuilder
          registry={contentReviewFields}
          clauses={clauses}
          fieldsByKey={fieldsByKey}
          onAdd={addClause}
          onRemove={removeClause}
          onUpdate={updateClause}
        />
      </div>

      <Button onClick={runFilters} disabled={loading || !canRun} className="w-full sm:w-auto">
        <Search className="h-4 w-4" />
        {loading ? "Running…" : "Run Filters"}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {canRun && allResults.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">{allResults.length} results</p>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setSelectedIds(new Set(allResults.map((i) => i.id)))}
                  className="text-primary hover:underline"
                >
                  Select all
                </button>
                {selectedIds.size > 0 && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="text-muted-foreground hover:underline"
                    >
                      None
                    </button>
                  </>
                )}
              </div>
            </div>
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                disabled={quarantining}
                onClick={quarantineSelected}
              >
                <FolderX className="h-3.5 w-3.5" />
                Quarantine {selectedIds.size}
              </Button>
            )}
          </div>
          <ImageGrid
            images={allResults}
            selectedIds={selectedIds}
            onToggle={toggleId}
            onOpen={setViewingImg}
          />
        </>
      )}

      {!loading && canRun && hasRun && allResults.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-12">
          No results. Try adjusting filters or search query.
        </p>
      )}

      {viewingImg && <ImageViewerModal img={viewingImg} onClose={() => setViewingImg(null)} />}
    </div>
  );
}
