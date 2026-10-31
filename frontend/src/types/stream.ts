export interface StreamPrepareStatus {
  status: "ready" | "running" | "error" | "not_started";
  progress: number;
  error: string | null;
  /** `direct` plays the file as-is; `hls` plays `url` (an `/api`-relative path). */
  mode: "direct" | "hls";
  url: string | null;
}
