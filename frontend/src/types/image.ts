export interface ImageLibrary {
  id: number;
  name: string;
  path: string;
  created_at: string;
  last_scanned_at: string | null;
  image_count: number;
}

interface ImageDetection {
  id: number;
  image_id: number;
  label: string;
  confidence: number;
  bbox_json: string | null;
}

export interface ImageFile {
  id: number;
  library_id: number;
  path: string;
  filename: string;
  extension: string;
  size: number;
  width: number | null;
  height: number | null;
  exif_date: number | null;
  exif_gps: string | null;
  exif_camera: string | null;
  file_mtime: number | null;
  status: string;
  scan_error: string | null;
  scanned_at: string | null;
  created_at: string;
  has_thumbnail: boolean;
  detections: ImageDetection[];
}

export interface ImagesResponse {
  items: ImageFile[];
  total: number;
  page: number;
  page_size: number;
}

export interface ImageScanRequest {
  run_phash: boolean;
  run_nudenet: boolean;
  reset: boolean;
}
