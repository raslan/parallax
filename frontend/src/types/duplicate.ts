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
  /** Shared audio, "Min shared": share (0-1) of the shorter file that must be found in the other. */
  audio_threshold: number;
  /** Shared audio, "Sounds alike" (0.65-0.95): server-side, changing it needs a new Extract. */
  audio_similarity: number;
  /** Shared audio, "Shared for at least" (seconds): server-side, changing it needs a new Extract. */
  audio_min_stretch: number;
}
