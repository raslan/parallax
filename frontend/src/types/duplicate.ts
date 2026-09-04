export interface DuplicateCriteria {
  use_size: boolean;
  use_duration: boolean;
  duration_tolerance: number;
  use_resolution: boolean;
  use_content_date: boolean;
  content_date_tolerance: number;
  use_orientation: boolean;
  use_bitrate: boolean;
  bitrate_tolerance_pct: number;
  use_filename: boolean;
  filename_threshold: number;
  use_byte_hash: boolean;
  use_phash: boolean;
  phash_threshold: number;
  phash_mode: "first_frame" | "all_frames";
  phash_frames: number;
  use_audio: boolean;
  audio_threshold: number;
}

export interface DuplicateGroup {
  files: import("./file").VideoFile[];
  keep_id: number;
}
