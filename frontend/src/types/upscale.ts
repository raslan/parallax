export type UpscaleTierId = "simple" | "sharp" | "best";
export type UpscaleScale = 1 | 2 | 4;

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
