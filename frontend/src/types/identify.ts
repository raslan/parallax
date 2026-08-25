export interface SearchResult {
  tmdb_id: number;
  title: string;
  year: number | null;
  overview: string;
  poster_path: string | null;
  type: string;
  number_of_seasons: number | null;
}

export interface Episode {
  season_number: number;
  episode_number: number;
  name: string;
  overview: string;
}

export interface FileMapping {
  file_path: string;
  season_number: number | null;
  episode_number: number | null;
  episode_name: string | null;
}

export interface RenameOp {
  old_path: string;
  new_path: string;
}

export interface PreviewResponse {
  file_ops: RenameOp[];
  folder_ops: RenameOp[];
}

export interface ApplyResponse {
  successes: string[];
  failures: { path: string; error: string }[];
}
