export interface ToolboxStartRequest {
  file_ids: number[];
  trim_start?: number;
  trim_end?: number;
  audio_channel?: "auto" | "left" | "right" | null;
  rotate_deg?: 90 | 180 | 270 | null;
  normalize?: boolean;
  faststart?: boolean;
  sync_offset_ms?: number | null;
  keep_original?: boolean;
}
