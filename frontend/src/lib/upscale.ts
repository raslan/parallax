import type { UpscaleScale } from "@/types/upscale";

/** Byte-mirror of backend `MAX_OUTPUT_PIXELS` (upscale_plan.py). */
const MAX_OUTPUT_PIXELS = 150_000_000;

/** Pre-scale is a percentage of the original size: 100 = off, and the backend accepts 10–100. */
export const PRESCALE_MIN = 10;
/** One-click fills for the percentage input; the input itself takes any whole percentage. */
export const PRESCALE_PRESETS = [25, 50, 75] as const;

/** Byte-mirror of backend `prescaled_size`: percent of a side, half-up, never below 1 px. */
function prescaledSide(n: number, prescale: number): number {
  return prescale >= 100 ? n : Math.max(1, Math.floor((n * prescale + 50) / 100));
}

/**
 * Size of the new file. With `prescale` < 100 the source is resized to that percentage first and
 * the model then runs at its native `scale`, so the result is `prescaled × scale`.
 */
export function outputDims(
  w: number,
  h: number,
  scale: UpscaleScale,
  prescale = 100,
): { w: number; h: number } {
  return { w: prescaledSide(w, prescale) * scale, h: prescaledSide(h, prescale) * scale };
}

/** A whole percentage within what the backend accepts; anything that isn't a number means "off". */
export function clampPrescale(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return Math.min(100, Math.max(PRESCALE_MIN, Math.round(n)));
}

/** How much bigger than the original the result is: the model's scale times the percentage. */
export function overallScale(native: number, prescale: number): number {
  return (native * prescale) / 100;
}

export function formatScale(x: number): string {
  return Number.isInteger(x) ? `${x}×` : `${x.toFixed(1)}×`;
}

export function speedLabel(speed: "fast" | "slow"): "Fast" | "Slow" {
  return speed === "fast" ? "Fast" : "Slow";
}

export function exceedsCap(w: number, h: number, scale: UpscaleScale, prescale = 100): boolean {
  const out = outputDims(w, h, scale, prescale);
  return out.w * out.h > MAX_OUTPUT_PIXELS;
}
