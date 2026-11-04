import { useId, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import type { UpscaleScale, UpscaleTier, UpscaleTierId } from "@/types/upscale";
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
import { clampScale, outputDims, speedLabel } from "@/lib/upscale";

const SCALES: UpscaleScale[] = [1, 2, 4];

/**
 * Trigger bar ("Sharp · 2×") + non-modal right Sheet with the upscale settings. Props-in /
 * callbacks-out, like `CompressEstimatePanel`: the page owns the state and the queries.
 * Must render inside a Router (the footer links to Settings → Credits).
 */
export function UpscalePanel({
  tiers,
  tier,
  scale,
  forceCpu,
  gpuAvailable,
  sampleDims,
  onTierChange,
  onScaleChange,
  onForceCpuChange,
}: {
  tiers: UpscaleTier[];
  tier: UpscaleTierId;
  scale: UpscaleScale;
  forceCpu: boolean;
  gpuAvailable: boolean;
  /** Source dimensions of the largest selected image, for the output-size line. */
  sampleDims: { w: number; h: number } | null;
  onTierChange: (t: UpscaleTierId) => void;
  onScaleChange: (s: UpscaleScale) => void;
  onForceCpuChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const cpuId = useId();
  const current = tiers.find((t) => t.id === tier);
  const out = sampleDims ? outputDims(sampleDims.w, sampleDims.h, scale) : null;

  const pickTier = (id: UpscaleTierId) => {
    onTierChange(id);
    const next = tiers.find((t) => t.id === id);
    if (next) {
      const clamped = clampScale(next, scale);
      if (clamped !== scale) onScaleChange(clamped);
    }
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
              <span className="text-muted-foreground">{` · ${scale}×`}</span>
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
                  <p className="text-xs font-medium text-foreground">Output size</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground/60">
                    Relative to the source. 1× keeps the same size and only restores detail.
                  </p>
                </div>
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
                    };
                  })}
                />
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
