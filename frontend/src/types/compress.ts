export interface CompressCodec {
  id: string;
  label: string;
  encoder: string;
  default_crf: number;
  crf_min: number;
  crf_max: number;
  description: string;
}

export interface ResolutionPreset {
  id: string;
  label: string;
  max_short_side: number | null;
}
