type SpliceVerdict = "copy" | "reencode";
export interface SplicePreflightFile {
  file_id: number;
  filename: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  reasons: string[];
}
export interface SplicePreflight {
  verdict: SpliceVerdict;
  reference_file_id: number;
  output_ext: string;
  output_dir: string;
  name_conflict: boolean;
  free_bytes: number;
  total_duration: number;
  total_size: number;
  files: SplicePreflightFile[];
}
export interface SplicePreflightRequest {
  file_ids: number[];
  reference_file_id?: number | null;
  output_name?: string | null;
  codec?: string;
}
interface SpliceReencode {
  codec: string;
  crf: number;
  speed: string;
  reference_file_id: number | null;
}
export interface SpliceMergeRequest {
  file_ids: number[];
  output_name: string;
  chapters: boolean;
  reencode: SpliceReencode | null;
}
