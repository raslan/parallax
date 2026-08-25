export interface Job {
  id: number;
  type: string;
  status: string;
  library_id: number | null;
  progress: number;
  total_files: number;
  processed_files: number;
  current_file: string | null;
  error: string | null;
  settings: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobLog {
  message: string;
  level: string;
  timestamp: string;
}
