export type UpscaleTierId = "simple" | "sharp" | "natural" | "detailed";
export type UpscaleScale = 1 | 2 | 4;
/** How the new size is chosen: a direct output size, or a pre-scale percentage. */
export type UpscaleResizeMode = "size" | "prescale";

export interface UpscaleTier {
  id: UpscaleTierId;
  label: string;
  /** The model's native factor. */
  scale: number;
  speed: "fast" | "slow";
  hint: string;
  /** Output factors this tier can produce. */
  scales: UpscaleScale[];
}

export interface UpscaleTiersResponse {
  tiers: UpscaleTier[];
  gpu_available: boolean;
}

export interface UpscaleStartRequest {
  file_ids: number[];
  tier: UpscaleTierId;
  scale: UpscaleScale;
  /** Percent of the original size to resize to before the model (100 = off, 10–100); the model then runs at its native scale. */
  prescale: number;
  /** The new file takes the original's place; the original goes to quarantine unless `keep_original` is off. */
  replace: boolean;
  keep_original: boolean;
  force_cpu: boolean;
}

export interface UpscaleSkipped {
  id: number;
  reason: string;
}

export interface UpscaleStartResponse {
  job_id: number;
  skipped: UpscaleSkipped[];
}

interface UpscaleCreditModel {
  name: string;
  tier: UpscaleTierId;
  author: string;
  licence: string;
  licence_url: string;
  release_url: string;
  note: string;
}

export interface UpscaleCredits {
  models: UpscaleCreditModel[];
  ncnn: {
    copyright: string;
    licence_name: string;
    url: string;
    text: string;
  };
}
