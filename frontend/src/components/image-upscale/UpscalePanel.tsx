import { useId, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import type { UpscaleResizeMode, UpscaleScale, UpscaleTier, UpscaleTierId } from "@/types/upscale";
import { RadioToggle } from "@/components/RadioToggle";
import { PanelSheetContent } from "@/components/PanelSheetContent";
import { UnitInput } from "@/components/UnitInput";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  PRESCALE_MIN,
  PRESCALE_PRESETS,
  clampPrescale,
  formatScale,
  outputDims,
  overallScale,
  speedLabel,
} from "@/lib/upscale";

const SCALES: UpscaleScale[] = [1, 2, 4];

/**
 * Trigger bar ("Fast · 4×") + non-modal right Sheet with the upscale settings. Props-in /
 * callbacks-out, like `CompressEstimatePanel`: the page owns the state and the queries.
 * Must render inside a Router (the footer links to Settings → Credits).
 *
 * The resize method is either an output size (1×/2×/4×, default = the model's own scale) or a
 * "Pre-scale" percentage: resize the image first, then run the model at its native scale. They
 * are exclusive. The percentage is a free input (any whole percent) with 25 / 50 / 75 chips as
 * one-click suggestions — the model never needs a whole-number ratio.
 */
export function UpscalePanel({
  tiers,
  tier,
  scale,
  resizeMode,
  prescale,
  forceCpu,
  gpuAvailable,
  sampleDims,
  onTierChange,
  onScaleChange,
  onResizeModeChange,
  onPrescaleChange,
  onForceCpuChange,
}: {
  tiers: UpscaleTier[];
  tier: UpscaleTierId;
  scale: UpscaleScale;
  resizeMode: UpscaleResizeMode;
  /** Percent of the original size to resize to first (10–100). */
  prescale: number;
  forceCpu: boolean;
  gpuAvailable: boolean;
  /** Source dimensions of the largest selected image, for the output-size line. */
  sampleDims: { w: number; h: number } | null;
  onTierChange: (t: UpscaleTierId) => void;
  onScaleChange: (s: UpscaleScale) => void;
  onResizeModeChange: (m: UpscaleResizeMode) => void;
  onPrescaleChange: (pct: number) => void;
  onForceCpuChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  // Text being typed in the percentage box; null = show the committed value.
  const [draft, setDraft] = useState<string | null>(null);
  const cpuId = useId();
  const current = tiers.find((t) => t.id === tier);
  const native = (current?.scale ?? 2) as UpscaleScale;
  const prescaling = resizeMode === "prescale";
  const out = sampleDims
    ? prescaling
      ? outputDims(sampleDims.w, sampleDims.h, native, prescale)
      : outputDims(sampleDims.w, sampleDims.h, scale)
    : null;
  const summary = prescaling ? `${prescale}% then ${native}×` : `${scale}×`;

  // Each model has its own natural size: moving to a model with a different native scale starts
  // from that, while a model with the same native scale keeps whatever size was chosen.
  const pickTier = (id: UpscaleTierId) => {
    onTierChange(id);
    const next = tiers.find((t) => t.id === id);
    if (next && current && next.scale !== current.scale) onScaleChange(next.scale as UpscaleScale);
  };

  // Typing "5" on the way to "50" must not be pushed up as a (too small) percentage: only a valid
  // value is committed while typing, and blur clamps whatever is left.
  const typePercent = (text: string) => {
    setDraft(text);
    const n = Number(text);
    if (text.trim() !== "" && Number.isInteger(n) && n >= PRESCALE_MIN && n <= 100) {
      onPrescaleChange(n);
    }
  };
  const commitPercent = () => {
    if (draft === null) return;
    onPrescaleChange(clampPrescale(draft.trim() === "" ? prescale : Number(draft)));
    setDraft(null);
  };

  const gpuNote = forceCpu
    ? "Using the CPU only"
    : gpuAvailable
      ? "GPU detected — it will be used automatically"
      : "CPU only — no compatible GPU found";

  return (
    <TooltipProvider delayDuration={150}>
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/15"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium">{current?.label ?? tier}</span>
              <span className="text-muted-foreground">{` · ${summary}`}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              Upscale settings
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        </SheetTrigger>

        <PanelSheetContent
          overlay={false}
          onInteractOutside={() => setOpen(false)}
          className="w-136 max-w-[92vw] gap-4 overflow-y-auto bg-card sm:w-152"
        >
          <SheetHeader>
            <SheetTitle>Upscale settings</SheetTitle>
            <SheetDescription>
              Pick a quality tier and the size of the new copy. The original is never touched.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4">
            <div className="divide-y divide-border/40 rounded-lg border border-border/50 bg-muted/10">
              <div className="space-y-2 px-4 py-4">
                <div>
                  <p className="text-xs font-medium text-foreground">Quality</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground/60">{current?.hint ?? ""}</p>
                </div>
                <RadioToggle
                  value={tier}
                  onChange={pickTier}
                  options={tiers.map((t) => ({
                    id: t.id,
                    label: t.label,
                    detail: speedLabel(t.speed),
                    hint: t.hint,
                  }))}
                />
              </div>

              <div className="space-y-2 px-4 py-4">
                <div>
                  <p className="text-xs font-medium text-foreground">Resize method</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground/60">
                    {prescaling
                      ? `Resizes the image to this percentage first, then the model rebuilds detail at ${native}×. Good for large but blurry images; a smaller percentage is faster but invents more.`
                      : "Makes the copy this much bigger than the original."}
                  </p>
                </div>
                <RadioToggle<UpscaleResizeMode>
                  value={resizeMode}
                  onChange={onResizeModeChange}
                  options={[
                    { id: "size", label: "Output size" },
                    { id: "prescale", label: "Pre-scale" },
                  ]}
                />
                {prescaling ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <RadioToggle
                      value={
                        (PRESCALE_PRESETS as readonly number[]).includes(prescale)
                          ? String(prescale)
                          : ""
                      }
                      onChange={(v) => {
                        setDraft(null);
                        onPrescaleChange(Number(v));
                      }}
                      options={PRESCALE_PRESETS.map((p) => ({ id: String(p), label: `${p}%` }))}
                    />
                    <UnitInput
                      unit="%"
                      aria-label="Pre-scale percentage"
                      min={PRESCALE_MIN}
                      max={100}
                      step={1}
                      value={draft ?? String(prescale)}
                      onChange={(e) => typePercent(e.target.value)}
                      onBlur={commitPercent}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitPercent();
                      }}
                      className="w-24"
                    />
                  </div>
                ) : (
                  <RadioToggle
                    value={String(scale)}
                    onChange={(v) => onScaleChange(Number(v) as UpscaleScale)}
                    options={SCALES.map((s) => {
                      const available = current?.scales.includes(s) ?? false;
                      return {
                        id: String(s),
                        label: `${s}×`,
                        disabled: !available,
                        detail: available ? undefined : "needs a 4× model",
                        hint:
                          s === 1
                            ? "Shrinking the result back to the original size mostly hides what the model added. Use Pre-scale for a same-size, sharper copy."
                            : undefined,
                      };
                    })}
                  />
                )}
                {out && (
                  <p className="text-xs text-muted-foreground">
                    Largest selected image becomes{" "}
                    <span className="font-mono tabular-nums text-foreground">
                      {out.w} × {out.h}
                    </span>
                    {prescaling && sampleDims && (
                      <span className="text-muted-foreground/70">
                        {` (${formatScale(overallScale(native, prescale))} the original)`}
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="space-y-2 px-4 py-4">
                <div className="flex items-center gap-3">
                  <Switch id={cpuId} checked={forceCpu} onCheckedChange={onForceCpuChange} />
                  <label htmlFor={cpuId} className="cursor-pointer select-none text-sm">
                    Use CPU only
                  </label>
                </div>
                <p className="text-2xs text-muted-foreground/60">{gpuNote}</p>
              </div>
            </div>

            <p className="text-2xs text-muted-foreground/60">
              <Link
                to="/settings?tab=credits"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Models by Philip Hofmann (Phhofm), CC BY 4.0
              </Link>
            </p>
          </div>
        </PanelSheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
