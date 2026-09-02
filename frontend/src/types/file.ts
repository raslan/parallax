export interface VideoFile {
  id: number;
  library_id: number;
  path: string;
  filename: string;
  size: number;
  duration: number | null;
  codec_name: string | null;
  video_bitrate: number | null;
  status: string;
  scanned_at: string | null;
  transcoded_at: string | null;
  created_at: string;
  has_thumbnail: boolean;
  file_width: number | null;
  file_height: number | null;
  file_fps: number | null;
  file_date: number | null;
}

export interface FilesResponse {
  items: VideoFile[];
  total: number;
  page: number;
  page_size: number;
}
