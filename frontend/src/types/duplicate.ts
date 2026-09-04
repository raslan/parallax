export interface DuplicateCriteria {
  use_size: boolean;
  use_duration: boolean;
  use_phash: boolean;
  duration_tolerance: number;
  phash_threshold: number;
  phash_mode: "first_frame" | "all_frames";
  phash_frames: number;
}

export interface DuplicateFile {
  id: number;
  library_id: number;
  path: string;
  filename: string;
  size: number;
  duration: number | null;
  codec_name: string | null;
  video_bitrate: number | null;
  status: string;
}

export interface DuplicateGroup {
  files: DuplicateFile[];
  keep_id: number;
}
