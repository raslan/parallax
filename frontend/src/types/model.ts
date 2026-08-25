export interface ModelInfo {
  id: string;
  type: "clip" | "nudenet" | "whisper";
  name: string;
  description: string;
  size_mb: number;
  quality: string;
  downloaded: boolean;
  active: boolean;
  bundled: boolean;
}

export interface ActiveModelDownload {
  job_id: number;
  model_type: string;
  model_id: string;
  status: string;
  progress: number;
  current_file: string | null;
}
