export interface Settings {
  max_concurrent_transcodes: number;
  tmdb_api_key: string;
  clip_model: string;
  nudenet_model: string;
  whisper_model: string;
  video_keyframes_per_video: number;
  scan_batch_size: number;
  scan_prefetch: number;
  subtitle_languages: string;
  download_dir: string;
  max_concurrent_downloads: number;
  ytdlp_channel: string;
  encoder_family: string;
  concurrent_limit_hint: number | null;
}

export interface UpdateSettingsBody {
  max_concurrent_transcodes?: number;
  tmdb_api_key?: string;
  clip_model?: string;
  nudenet_model?: string;
  whisper_model?: string;
  video_keyframes_per_video?: number;
  scan_batch_size?: number;
  scan_prefetch?: number;
  subtitle_languages?: string;
  download_dir?: string;
  max_concurrent_downloads?: number;
  ytdlp_channel?: string;
}
