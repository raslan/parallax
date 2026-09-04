export interface Settings {
  max_concurrent_transcodes: number;
  tmdb_api_key: string;
  nudenet_model: string;
  whisper_model: string;
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
}

export interface UpdateSettingsBody {
  max_concurrent_transcodes?: number;
  tmdb_api_key?: string;
  nudenet_model?: string;
  whisper_model?: string;
  scan_batch_size?: number;
  scan_prefetch?: number;
  subtitle_languages?: string;
  subtitle_sync_engine?: string;
  subtitle_auto_sync?: boolean;
  download_dir?: string;
  max_concurrent_downloads?: number;
  ytdlp_channel?: string;
}
