import { Controller } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
                  on your card makes each file take proportionally longer with no improvement in
                  total time.
                  {encoderFamily === "nvenc"
                    ? " NVIDIA: RTX 3050/3060 = 1 engine · RTX 3080/3090 = 2 · RTX 4090 = 3."
                    : encoderFamily === "qsv"
                      ? " Intel: UHD 630/730 = 1 engine · UHD 770 / Iris Xe / Arc = 2."
                      : encoderFamily === "amf" || encoderFamily === "vaapi"
                        ? " AMD: RX 6000 series = 1 engine · RX 7000 high-end = 2."
                        : " No hardware encoder detected — using CPU software encoding."}
                </p>
              </div>
              <Controller
                control={form.control}
                name="maxConcurrent"
                render={({ field }) => (
                  <>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min={1}
                        max={8}
                        value={field.value ?? 1}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        className="w-48 accent-primary"
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
