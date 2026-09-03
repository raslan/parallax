import { Loader2 } from "lucide-react";
import type { ActiveModelDownload, ModelInfo } from "@/types/model";
import { Card, CardContent } from "@/components/ui/card";
import { SaveButton, type SaveState } from "./SaveButton";
import { ModelCard } from "./ModelCard";

export function ModelsTab({
  loading,
  modelsLoading,
  scanBatchSize,
  onScanBatchSizeChange,
  scanPrefetch,
  onScanPrefetchChange,
  nudenetModels,
  whisperModels,
  activeDownload,
  reloadModels,
  save,
}: {
  loading: boolean;
  modelsLoading: boolean;
  scanBatchSize: number;
  onScanBatchSizeChange: (n: number) => void;
  scanPrefetch: number;
  onScanPrefetchChange: (n: number) => void;
  nudenetModels: ModelInfo[];
  whisperModels: ModelInfo[];
  activeDownload: ActiveModelDownload | null;
  reloadModels: () => void;
  save: SaveState;
}) {
  return (
    <div className="space-y-6">
      {/* Scan batch size */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="text-sm font-medium">Scan batch size</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              How many images to process in a single NudeNet inference pass. Higher values use more
              VRAM but scan faster.
            </p>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={32}
                  value={scanBatchSize}
                  onChange={(e) => onScanBatchSizeChange(Number(e.target.value))}
                  className="w-48 accent-primary"
                />
                <span className="text-sm font-mono w-16 text-right">{scanBatchSize} images</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {[1, 4, 8, 16].map((n) => (
                  <button
                    key={n}
                    onClick={() => onScanBatchSizeChange(n)}
                    className={`px-3 py-1 rounded text-xs border transition-colors ${
                      scanBatchSize === n
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <SaveButton {...save} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Scan prefetch */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="text-sm font-medium">Scan prefetch</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Image batches to pre-load into memory while the AI models process the current one.
              Overlaps disk reads with GPU inference. Higher values use more RAM but keep the GPU
              continuously fed.
            </p>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={scanPrefetch}
                  onChange={(e) => onScanPrefetchChange(Number(e.target.value))}
                  className="w-48 accent-primary"
                />
                <span className="text-sm font-mono w-4 text-center">{scanPrefetch}</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {[2, 4, 8, 16].map((n) => (
                  <button
                    key={n}
                    onClick={() => onScanPrefetchChange(n)}
                    className={`px-3 py-1 rounded text-xs border transition-colors ${
                      scanPrefetch === n
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <SaveButton {...save} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Model lists */}
      {modelsLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading models…
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div>
                <p className="text-sm font-medium">Content Detection (NudeNet)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Used when scanning images. Higher resolution models catch smaller or partial
                  detections.
                </p>
              </div>
              <div className="space-y-2">
                {nudenetModels.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    onAction={reloadModels}
                    activeDownload={activeDownload}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 space-y-4">
              <div>
                <p className="text-sm font-medium">Speech-to-Text (Whisper)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Generates subtitle files locally from video audio. No API key required. Larger
                  models are slower but more accurate.
                </p>
              </div>
              <div className="space-y-2">
                {whisperModels.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    onAction={reloadModels}
                    activeDownload={activeDownload}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
