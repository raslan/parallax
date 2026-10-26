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

/** The `--download-archive` file (`GET /galleries/archive`); `entries` null = couldn't be counted. */
export interface ArchiveInfo {
  path: string;
  exists: boolean;
  size: number;
  entries: number | null;
}

/** A named file-mode URL list (`GET /galleries/urllists`); `count` = URLs in it. */
export interface UrlListInfo {
  name: string;
  count: number;
}

export interface GalleryEnqueuePayload {
  urls: string[];
  cookies: string;
}
