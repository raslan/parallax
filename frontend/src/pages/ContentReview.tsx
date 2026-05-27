import { useState } from "react";
import { ShieldAlert, Search, FolderX } from "lucide-react";
import { imageApi, ImageFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DETECTION_GROUPS = [
  {
    label: "Exposed",
    labels: [
      "FEMALE_BREAST_EXPOSED",
      "FEMALE_GENITALIA_EXPOSED",
      "MALE_GENITALIA_EXPOSED",
      "BUTTOCKS_EXPOSED",
    ],
  },
  {
    label: "Covered",
    labels: [
      "FEMALE_BREAST_COVERED",
      "FEMALE_GENITALIA_COVERED",
      "MALE_GENITALIA_COVERED",
      "BUTTOCKS_COVERED",
    ],
  },
  {
    label: "Other",
    labels: ["BELLY_EXPOSED", "ARMPITS_EXPOSED", "FEET_EXPOSED"],
  },
];

function ImageGrid({
  images, selectedIds, onToggle,
}: { images: ImageFile[]; selectedIds: Set<number>; onToggle: (id: number) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {images.map((img) => (
        <div
          key={img.id}
          onClick={() => onToggle(img.id)}
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
          {selectedIds.has(img.id) && (
            <div className="absolute top-1 left-1 h-5 w-5 rounded bg-primary flex items-center justify-center">
              <span className="text-[10px] text-primary-foreground font-bold">✓</span>
            </div>
          )}
          {img.detections.length > 0 && (
            <div className="absolute top-1 right-1 rounded bg-destructive/90 px-1 py-0.5 text-[10px] text-white">
              {img.detections.length}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ContentReview() {
  const [checkedLabels, setCheckedLabels] = useState<Set<string>>(new Set([
    "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED",
  ]));
  const [confidence, setConfidence] = useState(0.7);
  const [searchQuery, setSearchQuery] = useState("");
  const [detectionResults, setDetectionResults] = useState<ImageFile[]>([]);
  const [searchResults, setSearchResults] = useState<ImageFile[]>([]);
  const [selectedIds, setSelectedIds] = useState(new Set<number>());
  const [loading, setLoading] = useState(false);
  const [quarantining, setQuarantining] = useState(false);

  const allResults = [
    ...detectionResults,
    ...searchResults.filter((sr) => !detectionResults.some((dr) => dr.id === sr.id)),
  ];

  const toggleLabel = (label: string) =>
    setCheckedLabels((s) => { const n = new Set(s); n.has(label) ? n.delete(label) : n.add(label); return n; });

  const toggleId = (id: number) =>
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function runFilters() {
    setLoading(true);
    setDetectionResults([]);
    setSearchResults([]);
    setSelectedIds(new Set());
    try {
      const promises: Promise<void>[] = [];

      if (checkedLabels.size > 0) {
        promises.push(
          imageApi.filterByDetections({
            labels: [...checkedLabels],
            min_confidence: confidence,
            page_size: 200,
          }).then((r) => setDetectionResults(r.items))
        );
      }

      if (searchQuery.trim()) {
        promises.push(
          imageApi.searchImages(searchQuery.trim(), { limit: 200 })
            .then((results) => setSearchResults(results.map((r) => r.image)))
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-5 w-5" style={{ color: "var(--px-accent)" }} />
        <div>
          <h1 className="text-lg font-semibold">Content Review</h1>
          <p className="text-xs text-muted-foreground">
            Filter images by detected content or search by description.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Detection Labels
          </p>
          <div className="mb-4 flex flex-col gap-3">
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
          <Button
            size="sm" variant="outline" className="mt-3 w-full text-xs"
            onClick={() => setCheckedLabels(new Set([
              "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED",
              "MALE_GENITALIA_EXPOSED", "BUTTOCKS_EXPOSED",
            ]))}
          >
            Exposed Only Preset
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Semantic Search
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            Describe what you're looking for. Results are ranked by visual similarity.
          </p>
          <Input
            placeholder="e.g. person at beach, food, outdoor scene…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runFilters()}
            className="text-sm"
          />
        </div>
      </div>

      <Button onClick={runFilters} disabled={loading} className="w-full sm:w-auto">
        <Search className="h-4 w-4" />
        {loading ? "Searching…" : "Run Filters"}
      </Button>

      {allResults.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{allResults.length} results</p>
            {selectedIds.size > 0 && (
              <Button size="sm" variant="destructive" disabled={quarantining} onClick={quarantineSelected}>
                <FolderX className="h-3.5 w-3.5" />
                Quarantine {selectedIds.size}
              </Button>
            )}
          </div>
          <ImageGrid images={allResults} selectedIds={selectedIds} onToggle={toggleId} />
        </>
      )}

      {!loading && allResults.length === 0 && (checkedLabels.size > 0 || searchQuery) && (
        <p className="text-center text-sm text-muted-foreground py-12">
          No results. Try adjusting the confidence threshold or search query.
        </p>
      )}
    </div>
  );
}
