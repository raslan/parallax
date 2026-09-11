interface DetectedGpu {
  vendor: string;
  label: string;
}

export interface Settings {
  max_concurrent_transcodes: number;
  max_concurrent_jobs: number;
  max_concurrent_audio_transcodes: number;
  tmdb_api_key: string;
  nudenet_model: string;
  scan_batch_size: number;
  scan_prefetch: number;
  subtitle_languages: string;
  subtitle_sync_engine: string;
  subtitle_auto_sync: boolean;
  download_dir: string;
  max_concurrent_downloads: number;
  ytdlp_channel: string;
  encoder_family: string;
  concurrent_limit_hint: number | null;
  detected_gpus: DetectedGpu[];
}

export interface UpdateSettingsBody {
  max_concurrent_transcodes?: number;
  max_concurrent_jobs?: number;
  max_concurrent_audio_transcodes?: number;
  tmdb_api_key?: string;
  nudenet_model?: string;
  scan_batch_size?: number;
  scan_prefetch?: number;
  subtitle_languages?: string;
  subtitle_sync_engine?: string;
  subtitle_auto_sync?: boolean;
  download_dir?: string;
  max_concurrent_downloads?: number;
  ytdlp_channel?: string;
}
