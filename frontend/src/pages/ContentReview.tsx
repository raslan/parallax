import { useState } from "react";
import { ShieldAlert, Search, FolderX } from "lucide-react";
import { imageApi, ImageFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const DETECTION_GROUPS = [
  {
    label: "Exposed",
    labels: [
      "FEMALE_BREAST_EXPOSED",
      "FEMALE_GENITALIA_EXPOSED",
      "MALE_GENITALIA_EXPOSED",
      "MALE_BREAST_EXPOSED",
      "BUTTOCKS_EXPOSED",
      "ANUS_EXPOSED",
    ],
  },
  {
    label: "Covered",
    labels: [
      "FEMALE_BREAST_COVERED",
      "FEMALE_GENITALIA_COVERED",
      "MALE_GENITALIA_COVERED",
      "BUTTOCKS_COVERED",
      "ANUS_COVERED",
    ],
  },
  {
    label: "Other",
    labels: [
      "BELLY_EXPOSED",
      "BELLY_COVERED",
      "ARMPITS_EXPOSED",
      "ARMPITS_COVERED",
      "FEET_EXPOSED",
      "FEET_COVERED",
      "FACE_FEMALE",
      "FACE_MALE",
    ],
  },
];

function ImageGrid({
  images, selectedIds, onToggle, onOpen,
}: { images: ImageFile[]; selectedIds: Set<number>; onToggle: (id: number) => void; onOpen: (img: ImageFile) => void }) {
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
            <img src={imageApi.thumbnailUrl(img.id)} alt={img.filename}
                 className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-muted" />
          )}
          <div
            onClick={(e) => { e.stopPropagation(); onToggle(img.id); }}
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
                        <span className="text-muted-foreground truncate">{d.label.replace(/_/g, " ").toLowerCase()}</span>
                        <span className="font-mono tabular-nums shrink-0">{(d.confidence * 100).toFixed(0)}%</span>
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

type CombineMode = "union" | "intersection";

export function ContentReview() {
  const [detectionEnabled, setDetectionEnabled] = useState(true);
  const [checkedLabels, setCheckedLabels] = useState<Set<string>>(new Set([
    "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED",
  ]));
  const [confidence, setConfidence] = useState(0.7);
  const [invertDetection, setInvertDetection] = useState(false);

  const [searchEnabled, setSearchEnabled] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [invertSearch, setInvertSearch] = useState(false);

  const [minScore, setMinScore] = useState(0.2);
  const [combineMode, setCombineMode] = useState<CombineMode>("union");

  const [detectionResults, setDetectionResults] = useState<ImageFile[]>([]);
  const [searchResults, setSearchResults] = useState<{ image: ImageFile; score: number }[]>([]);
  const [selectedIds, setSelectedIds] = useState(new Set<number>());
  const [loading, setLoading] = useState(false);
  const [quarantining, setQuarantining] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [viewingImg, setViewingImg] = useState<ImageFile | null>(null);

  const bothActive = detectionEnabled && checkedLabels.size > 0 && searchEnabled && searchQuery.trim().length > 0;

  const filteredSearchImages = searchResults
    .filter((r) => invertSearch ? r.score < minScore : r.score >= minScore)
    .map((r) => r.image);

  const allResults = (() => {
    if (!bothActive || combineMode === "union") {
      return [
        ...detectionResults,
        ...filteredSearchImages.filter((sr) => !detectionResults.some((dr) => dr.id === sr.id)),
      ];
    }
    // intersection: only images present in both
    const detectionIds = new Set(detectionResults.map((r) => r.id));
    return filteredSearchImages.filter((sr) => detectionIds.has(sr.id));
  })();

  const toggleLabel = (label: string) =>
    setCheckedLabels((s) => { const n = new Set(s); n.has(label) ? n.delete(label) : n.add(label); return n; });

  const toggleId = (id: number) =>
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function runFilters() {
    setLoading(true);
    setDetectionResults([]);
    setSearchResults([]);
    setSelectedIds(new Set());
    setHasRun(true);
    try {
      const promises: Promise<void>[] = [];

      if (detectionEnabled && checkedLabels.size > 0) {
        promises.push(
          imageApi.filterByDetections({
            labels: [...checkedLabels],
            min_confidence: confidence,
            exclude: invertDetection,
            page_size: 10000,
          }).then((r) => setDetectionResults(r.items))
        );
      }

      if (searchEnabled && searchQuery.trim()) {
        promises.push(
          imageApi.searchImages(searchQuery.trim(), { limit: 10000 })
            .then(setSearchResults)
        );
      }

      await Promise.all(promises);
    } finally {
      setLoading(false);
    }
  }

  async function quarantineSelected() {
    if (!selectedIds.size) return;
    setQuarantining(true);
    try {
      await imageApi.quarantineBulk([...selectedIds]);
      setSelectedIds(new Set());
      await runFilters();
    } finally {
      setQuarantining(false);
    }
  }

  const canRun =
    (detectionEnabled && checkedLabels.size > 0) ||
    (searchEnabled && searchQuery.trim().length > 0);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-5 w-5" style={{ color: "var(--px-accent)" }} />
        <div>
          <h1 className="text-lg font-semibold">Content Review</h1>
          <p className="text-xs text-muted-foreground">
            Filter images by detected content or semantic search. Enable one or both.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Detection panel */}
        <div className={`rounded-lg border bg-card p-4 transition-opacity ${detectionEnabled ? "border-border" : "border-border opacity-50"}`}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Detection Labels
            </p>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-muted-foreground">Enable</span>
              <input
                type="checkbox"
                checked={detectionEnabled}
                onChange={(e) => setDetectionEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
            </label>
          </div>

          <div className={`mb-4 flex flex-col gap-3 ${!detectionEnabled ? "pointer-events-none" : ""}`}>
            {DETECTION_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 text-xs text-muted-foreground">{group.label}</p>
                <div className="flex flex-col gap-1.5">
                  {group.labels.map((label) => (
                    <label key={label} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checkedLabels.has(label)}
                        onChange={() => toggleLabel(label)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <span className="font-mono text-xs">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={`space-y-3 ${!detectionEnabled ? "pointer-events-none" : ""}`}>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                Min Confidence: <span className="font-mono">{confidence.toFixed(2)}</span>
              </p>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            <div className="flex items-center gap-4">
              <Button
                size="sm" variant="outline" className="text-xs"
                onClick={() => setCheckedLabels(new Set([
                  "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED",
                  "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED",
                ]))}
              >
                Exposed Only
              </Button>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={invertDetection}
                  onChange={(e) => setInvertDetection(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-xs text-muted-foreground">Invert (exclude matches)</span>
              </label>
            </div>
          </div>
        </div>

        {/* Search panel */}
        <div className={`rounded-lg border bg-card p-4 transition-opacity ${searchEnabled ? "border-border" : "border-border opacity-50"}`}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Semantic Search
            </p>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-muted-foreground">Enable</span>
              <input
                type="checkbox"
                checked={searchEnabled}
                onChange={(e) => setSearchEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
            </label>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Describe what you're looking for. Results are ranked by visual similarity.
          </p>
          <Input
            placeholder="e.g. person at beach, food, outdoor scene…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canRun && runFilters()}
            disabled={!searchEnabled}
            className="text-sm"
          />
          <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={invertSearch}
              onChange={(e) => setInvertSearch(e.target.checked)}
              disabled={!searchEnabled}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-xs text-muted-foreground">Exclude matches (show images that do not match)</span>
          </label>
          <div className={`mt-3 ${!searchEnabled ? "pointer-events-none opacity-50" : ""}`}>
            <p className="mb-1 text-xs text-muted-foreground">
              Min similarity: <span className="font-mono">{minScore.toFixed(2)}</span>
            </p>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              disabled={!searchEnabled}
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>

      {/* Combine mode — only shown when both active */}
      {bothActive && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Combine results:</span>
          {(["union", "intersection"] as CombineMode[]).map((mode) => (
            <label key={mode} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="radio"
                name="combineMode"
                value={mode}
                checked={combineMode === mode}
                onChange={() => setCombineMode(mode)}
                className="accent-primary"
              />
              <span className="capitalize">{mode === "union" ? "OR (either)" : "AND (both)"}</span>
            </label>
          ))}
        </div>
      )}

      <Button onClick={runFilters} disabled={loading || !canRun} className="w-full sm:w-auto">
        <Search className="h-4 w-4" />
        {loading ? "Searching…" : "Run Filters"}
      </Button>

      {allResults.length > 0 && (
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
                    <button onClick={() => setSelectedIds(new Set())} className="text-muted-foreground hover:underline">
                      None
                    </button>
                  </>
                )}
              </div>
            </div>
            {selectedIds.size > 0 && (
              <Button size="sm" variant="destructive" disabled={quarantining} onClick={quarantineSelected}>
                <FolderX className="h-3.5 w-3.5" />
                Quarantine {selectedIds.size}
              </Button>
            )}
          </div>
          <ImageGrid images={allResults} selectedIds={selectedIds} onToggle={toggleId} onOpen={setViewingImg} />
        </>
      )}

      {!loading && hasRun && allResults.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-12">
          No results. Try adjusting filters or search query.
        </p>
      )}

      {viewingImg && (
        <ImageViewerModal img={viewingImg} onClose={() => setViewingImg(null)} />
      )}
    </div>
  );
}
