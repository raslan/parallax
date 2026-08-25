export interface DownloadItem {
  id: number;
  url: string;
  title: string | null;
  uploader: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  speed: string | null;
  eta: string | null;
  error: string | null;
  output_path: string | null;
  output_dir: string;
  options: string | null;
  source_url: string | null;
  playlist_id: string | null;
  playlist_title: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface DownloadRequest {
  urls: string[];
  output_dir?: string;
  audio_only?: boolean;
  quality?: string;
  codec?: string;
  trim_start?: string | null;
  trim_end?: string | null;
  download_subs?: boolean;
  sub_langs?: string;
  extra_args?: string;
  impersonate?: string | null;
  cookies?: string;
}
