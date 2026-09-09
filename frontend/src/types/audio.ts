export interface AudioLibrary {
  id: number;
  name: string;
  path: string;
  created_at: string;
  last_scanned_at: string | null;
  file_count: number;
}

export interface AudioFile {
  id: number;
  library_id: number;
  path: string;
  filename: string;
  extension: string | null;
  size: number;
  duration: number | null;
  codec_name: string | null;
  bitrate: number | null;
  sample_rate: number | null;
  channels: number | null;
  channel_layout: string | null;
  file_date: number | null;
  file_mtime: number | null;
  status: string;
  scan_error: string | null;
  scanned_at: string | null;
  compressed_at: string | null;
  created_at: string;
}

export interface AudioCodec {
  id: string;
  label: string;
  encoder: string;
  ext: string;
  bitrate_min: number;
  bitrate_default: number;
  bitrate_max: number;
  tiers: { max_kbps: number; label: string }[];
}

interface AudioOriginalEntry {
  path: string;
  filename: string;
  library_id: number;
  library_name: string;
  original_size: number;
  current_path: string | null;
  current_size: number | null;
  savings_bytes: number | null;
}

export interface AudioOriginalsSummary {
  entries: AudioOriginalEntry[];
  total_original_bytes: number;
  total_current_bytes: number;
  total_savings_bytes: number;
}
