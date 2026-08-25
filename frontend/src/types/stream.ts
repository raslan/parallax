export interface StreamPrepareStatus {
  status: "ready" | "running" | "error" | "not_started";
  progress: number;
  error: string | null;
}
