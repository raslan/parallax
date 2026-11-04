import type { UpscaleScale, UpscaleTier } from "@/types/upscale";

/** Byte-mirror of backend `MAX_OUTPUT_PIXELS` (upscale_plan.py). */
const MAX_OUTPUT_PIXELS = 150_000_000;

/** Largest scale the tier offers that is ≤ the request, else its smallest. */
export function clampScale(tier: UpscaleTier, scale: UpscaleScale): UpscaleScale {
  const below = tier.scales.filter((s) => s <= scale);
  const pick = below.length ? Math.max(...below) : Math.min(...tier.scales);
  return pick as UpscaleScale;
}

export function outputDims(w: number, h: number, scale: UpscaleScale): { w: number; h: number } {
  return { w: w * scale, h: h * scale };
}

export function speedLabel(speed: "fast" | "slow"): "Fast" | "Slow" {
  return speed === "fast" ? "Fast" : "Slow";
}

export function exceedsCap(w: number, h: number, scale: UpscaleScale): boolean {
  return w * h * scale * scale > MAX_OUTPUT_PIXELS;
}
