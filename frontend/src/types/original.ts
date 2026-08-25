export interface Original {
  path: string;
  filename: string;
  library_id: number;
  library_name: string;
  original_size: number;
  current_path: string | null;
  current_size: number | null;
  savings_bytes: number | null;
}

export interface OriginalsSummary {
  entries: Original[];
  total_original_bytes: number;
  total_current_bytes: number;
  total_savings_bytes: number;
}
