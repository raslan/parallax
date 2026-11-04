export type UpscaleTierId = "simple" | "sharp" | "best";
export type UpscaleScale = 1 | 2 | 4;
/** 1 = off; >1 shrinks the image first, then the model runs at its native scale. */
export type UpscaleShrink = 1 | 2 | 3 | 4;
/** How the new size is chosen: a direct output size, or shrink-first. */
export type UpscaleResizeMode = "size" | "shrink";

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
  shrink: UpscaleShrink;
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
