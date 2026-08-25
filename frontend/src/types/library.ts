export interface Library {
  id: number;
  name: string;
  path: string;
  created_at: string;
  last_scanned_at: string | null;
  file_count: number;
  corrupt_count: number;
}

export interface BrowseResponse {
  path: string;
  dirs: string[];
  files: import("./file").VideoFile[];
}

export interface Stats {
  total_libraries: number;
  total_files: number;
  corrupt_files: number;
  transcoded_files: number;
  total_size_bytes: number;
  scanning: boolean;
}
