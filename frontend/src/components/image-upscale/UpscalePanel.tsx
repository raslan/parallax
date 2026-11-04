import { useId, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import type {
  UpscaleResizeMode,
  UpscaleScale,
  UpscaleShrink,
  UpscaleTier,
  UpscaleTierId,
} from "@/types/upscale";
import { RadioToggle } from "@/components/RadioToggle";
import { PanelSheetContent } from "@/components/PanelSheetContent";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { outputDims, speedLabel } from "@/lib/upscale";

const SCALES: UpscaleScale[] = [1, 2, 4];
const SHRINKS: { id: UpscaleShrink; label: string }[] = [
  { id: 2, label: "½" },
  { id: 3, label: "⅓" },
  { id: 4, label: "¼" },
];
const SHRINK_LABEL: Record<number, string> = { 2: "½", 3: "⅓", 4: "¼" };

/**
 * Trigger bar ("Sharp · 2×") + non-modal right Sheet with the upscale settings. Props-in /
 * callbacks-out, like `CompressEstimatePanel`: the page owns the state and the queries.
 * Must render inside a Router (the footer links to Settings → Credits).
 *
 * The resize method is either an output size (1×/2×/4×, default = the model's own scale) or
 * "Shrink first": shrink the image, then run the model at its native scale. They are exclusive.
 */
export function UpscalePanel({
  tiers,
  tier,
  scale,
  resizeMode,
  shrink,
  forceCpu,
  gpuAvailable,
  sampleDims,
  onTierChange,
  onScaleChange,
  onResizeModeChange,
  onShrinkChange,
  onForceCpuChange,
}: {
  tiers: UpscaleTier[];
  tier: UpscaleTierId;
  scale: UpscaleScale;
  resizeMode: UpscaleResizeMode;
  shrink: UpscaleShrink;
  forceCpu: boolean;
  gpuAvailable: boolean;
  /** Source dimensions of the largest selected image, for the output-size line. */
  sampleDims: { w: number; h: number } | null;
  onTierChange: (t: UpscaleTierId) => void;
  onScaleChange: (s: UpscaleScale) => void;
  onResizeModeChange: (m: UpscaleResizeMode) => void;
  onShrinkChange: (s: UpscaleShrink) => void;
  onForceCpuChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const cpuId = useId();
  const current = tiers.find((t) => t.id === tier);
  const native = (current?.scale ?? 2) as UpscaleScale;
  const shrinking = resizeMode === "shrink";
  const out = sampleDims
    ? shrinking
      ? outputDims(sampleDims.w, sampleDims.h, native, shrink)
      : outputDims(sampleDims.w, sampleDims.h, scale)
    : null;
  const summary = shrinking ? `${SHRINK_LABEL[shrink] ?? shrink} then ${native}×` : `${scale}×`;

  // Each model has its own natural size: moving to a model with a different native scale starts
  // from that, while a model with the same native scale keeps whatever size was chosen.
  const pickTier = (id: UpscaleTierId) => {
    onTierChange(id);
    const next = tiers.find((t) => t.id === id);
    if (next && current && next.scale !== current.scale) onScaleChange(next.scale as UpscaleScale);
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
                    {shrinking
                      ? `Shrinks the image first, then the model rebuilds detail at ${native}×. Good for large but blurry images.`
                      : "Makes the copy this much bigger than the original."}
                  </p>
                </div>
                <RadioToggle<UpscaleResizeMode>
                  value={resizeMode}
                  onChange={onResizeModeChange}
                  options={[
                    { id: "size", label: "Output size" },
                    { id: "shrink", label: "Shrink first" },
                  ]}
                />
                {shrinking ? (
                  <RadioToggle
                    value={String(shrink)}
                    onChange={(v) => onShrinkChange(Number(v) as UpscaleShrink)}
                    options={SHRINKS.map((s) => ({ id: String(s.id), label: s.label }))}
                  />
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
                        detail: available ? undefined : "needs Best",
                        hint:
                          s === 1
                            ? "Shrinking the result back to the original size mostly hides what the model added. Use Shrink first for a same-size, sharper copy."
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
