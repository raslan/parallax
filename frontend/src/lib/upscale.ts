import type { UpscaleScale, UpscaleShrink } from "@/types/upscale";

/** Byte-mirror of backend `MAX_OUTPUT_PIXELS` (upscale_plan.py). */
const MAX_OUTPUT_PIXELS = 150_000_000;

/** Byte-mirror of backend `shrunk_size`: half-up per side, never below 1 px. */
function shrunkSide(n: number, shrink: UpscaleShrink): number {
  return shrink <= 1 ? n : Math.max(1, Math.floor((n + Math.floor(shrink / 2)) / shrink));
}

/**
 * Size of the new file. With `shrink` > 1 the source is shrunk first and the model then runs at
 * its native `scale`, so the result is `shrunk × scale`.
 */
export function outputDims(
  w: number,
  h: number,
  scale: UpscaleScale,
  shrink: UpscaleShrink = 1,
): { w: number; h: number } {
  return { w: shrunkSide(w, shrink) * scale, h: shrunkSide(h, shrink) * scale };
}

export function speedLabel(speed: "fast" | "slow"): "Fast" | "Slow" {
  return speed === "fast" ? "Fast" : "Slow";
}

export function exceedsCap(
  w: number,
  h: number,
  scale: UpscaleScale,
  shrink: UpscaleShrink = 1,
): boolean {
  const out = outputDims(w, h, scale, shrink);
  return out.w * out.h > MAX_OUTPUT_PIXELS;
}
