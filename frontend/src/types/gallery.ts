export interface GalleryDownload {
  id: number;
  url: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  files_done: number;
  files_skipped: number;
  files_failed: number;
  last_filename: string | null;
  recent_files: string[];
  error: string | null;
  log_tail: string | null;
  output_dir: string;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface GalleryEnqueuePayload {
  urls: string[];
  cookies: string;
}
