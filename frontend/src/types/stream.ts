export interface StreamPrepareStatus {
  /** `playable`: HLS has enough segments to start while the backend keeps converting. */
  status: "ready" | "playable" | "running" | "error" | "not_started";
  progress: number;
  error: string | null;
  /** `direct` plays the file as-is; `hls` plays `url` (an `/api`-relative path). */
  mode: "direct" | "hls";
  url: string | null;
}
