import { Controller } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { transcodingSchema, seedTranscoding } from "@/lib/schemas/settings";
import { SaveButton } from "./SaveButton";
import { useSettingsForm } from "./useSettingsForm";

export function TranscodingTab() {
  const { form, settings, isLoading, save } = useSettingsForm(
    transcodingSchema,
    seedTranscoding,
    (v) => ({ max_concurrent_transcodes: v.maxConcurrent }),
  );
  const encoderFamily = settings?.encoder_family ?? "software";
  const gpus = settings?.detected_gpus ?? [];

  const hintCopy = (() => {
    if (gpus.length === 0) {
      return encoderFamily === "software"
        ? " No hardware encoder detected — using CPU software encoding."
        : " No GPU devices detected for the active encoder family.";
    }
    const label = gpus[0]?.label ?? "GPU";
    const allSameLabel = gpus.every((g) => g.label === label);
    const countLabel = allSameLabel ? `${gpus.length}× ${label}` : `${gpus.length} GPUs`;
    if (encoderFamily === "nvenc") {
      return (
        ` ${countLabel} detected. NVIDIA's real per-card session limit varies by GPU/driver — ` +
        "check NVIDIA's official video encode/decode support matrix before raising this " +
        "much above ~3× the number of cards."
      );
    }
    return ` ${countLabel} detected. No known session-count cap for this encoder family — raise as high as your cards can sustain.`;
  })();

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Concurrent transcodes</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  How many files to encode in parallel within a compress job. Each session shares
                  the GPU's fixed encode hardware — setting this above the number of encode engines
                  on your card(s) makes each file take proportionally longer with no improvement in
                  total time.
                  {hintCopy}
                </p>
              </div>
              <Controller
                control={form.control}
                name="maxConcurrent"
                render={({ field }) => (
                  <>
                    <div className="flex items-center gap-4">
                      <Slider
                        min={1}
                        max={32}
                        value={[field.value ?? 1]}
                        onValueChange={([v]) => field.onChange(v ?? 1)}
                        className="w-48"
                      />
                      <span className="text-sm font-mono w-4 text-center">{field.value}</span>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {[1, 2, 3, 4].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => field.onChange(n)}
                          className={`px-3 py-1 rounded text-xs border transition-colors ${
                            field.value === n
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border hover:bg-accent"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              />
            </div>
            <SaveButton {...save} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
