import { Controller } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { modelsApi, qk } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { aiModelsSchema, seedAiModels } from "@/lib/schemas/settings";
import { SaveButton } from "./SaveButton";
import { useSettingsForm } from "./useSettingsForm";
import { ModelCard } from "./ModelCard";

function SliderRow({
  value,
  onChange,
  min,
  max,
  presets,
  unit,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  presets: number[];
  unit?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={min}
          max={max}
          value={value ?? min}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-48 accent-primary"
        />
        <span className={`text-sm font-mono ${unit ? "w-16 text-right" : "w-4 text-center"}`}>
          {value}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div className="flex gap-1 flex-wrap">
        {presets.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`px-3 py-1 rounded text-xs border transition-colors ${
              value === n
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:bg-accent"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </>
  );
}

export function ModelsTab() {
  const { form, isLoading, save } = useSettingsForm(aiModelsSchema, seedAiModels, (v) => ({
    scan_batch_size: v.scanBatchSize,
    scan_prefetch: v.scanPrefetch,
  }));

  const qc = useQueryClient();
  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: qk.models(),
    queryFn: () => modelsApi.listModels(),
  });
  const { data: activeDownload = null } = useQuery({
    queryKey: qk.modelActiveDownload(),
    queryFn: () => modelsApi.getActiveDownload(),
  });
  const reloadModels = () => {
    qc.invalidateQueries({ queryKey: qk.models() });
    qc.invalidateQueries({ queryKey: qk.modelActiveDownload() });
  };

  const nudenetModels = models.filter((m) => m.type === "nudenet");
  const whisperModels = models.filter((m) => m.type === "whisper");

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="text-sm font-medium">Scan batch size</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              How many images to process in a single NudeNet inference pass. Higher values use more
              VRAM but scan faster.
            </p>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <Controller
                control={form.control}
                name="scanBatchSize"
                render={({ field }) => (
                  <SliderRow
                    value={field.value}
                    onChange={field.onChange}
                    min={1}
                    max={32}
                    presets={[1, 4, 8, 16]}
                    unit="images"
                  />
                )}
              />
              <SaveButton {...save} />
            </>
          )}
        </CardContent>
      </Card>

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
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <Controller
                control={form.control}
                name="scanPrefetch"
                render={({ field }) => (
                  <SliderRow
                    value={field.value}
                    onChange={field.onChange}
                    min={1}
                    max={20}
                    presets={[2, 4, 8, 16]}
                  />
                )}
              />
              <SaveButton {...save} />
            </>
          )}
        </CardContent>
      </Card>

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
