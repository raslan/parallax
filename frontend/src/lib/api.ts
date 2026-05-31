const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

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

export interface Library {
  id: number;
  name: string;
  path: string;
  created_at: string;
  last_scanned_at: string | null;
  file_count: number;
  corrupt_count: number;
}

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
  scan_error: string | null;
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
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobLog {
  message: string;
  level: string;
  timestamp: string;
}

export interface BrowseResponse {
  path: string;
  dirs: string[];
  files: VideoFile[];
}

export interface Stats {
  total_libraries: number;
  total_files: number;
  corrupt_files: number;
  transcoded_files: number;
  total_size_bytes: number;
  scanning: boolean;
}

export interface DuplicateCriteria {
  use_size: boolean;
  use_duration: boolean;
  use_phash: boolean;
  duration_tolerance: number;
  phash_threshold: number;
  phash_mode: "first_frame" | "all_frames";
}

export interface DuplicateFile {
  id: number;
  library_id: number;
  path: string;
  filename: string;
  size: number;
  duration: number | null;
  codec_name: string | null;
  video_bitrate: number | null;
  status: string;
  has_thumbnail: boolean;
}

export interface DuplicateGroup {
  files: DuplicateFile[];
  keep_id: number;
}

export interface CleanupParams {
  duration_op?: "lt" | "gt";
  duration_secs?: number;
  fps_op?: "lt" | "gt";
  fps_val?: number;
  date_op?: "before" | "after";
  date_ts?: number;
  height_op?: "lt" | "gt";
  height_val?: number;
}

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

function buildCleanupQuery(params: CleanupParams): string {
  const q = new URLSearchParams();
  if (params.duration_op)                q.set("duration_op",   params.duration_op);
  if (params.duration_secs !== undefined) q.set("duration_secs", String(params.duration_secs));
  if (params.fps_op)                     q.set("fps_op",        params.fps_op);
  if (params.fps_val !== undefined)      q.set("fps_val",       String(params.fps_val));
  if (params.date_op)                    q.set("date_op",       params.date_op);
  if (params.date_ts !== undefined)      q.set("date_ts",       String(params.date_ts));
  if (params.height_op)                  q.set("height_op",     params.height_op);
  if (params.height_val !== undefined)   q.set("height_val",    String(params.height_val));
  return q.toString();
}

export const api = {
  // Libraries
  getLibraries: () => req<Library[]>("/libraries"),
  getStats: () => req<Stats>("/libraries/stats"),
  createLibrary: (body: { name: string; path: string; split_into_sublibraries?: boolean }) =>
    req<Library[]>("/libraries", { method: "POST", body: JSON.stringify(body) }),
  deleteLibrary: (id: number) => req<void>(`/libraries/${id}`, { method: "DELETE" }),
  scanLibrary: (id: number) => req<{ message: string }>(`/libraries/${id}/scan`, { method: "POST" }),
  checkLibrary: (id: number) => req<{ message: string }>(`/libraries/${id}/check`, { method: "POST" }),
  browseLibrary: (id: number, path: string, status?: string, sort_by?: string, sort_dir?: string) => {
    const q = new URLSearchParams({ path });
    if (status)   q.set("status",   status);
    if (sort_by)  q.set("sort_by",  sort_by);
    if (sort_dir) q.set("sort_dir", sort_dir);
    return req<BrowseResponse>(`/libraries/${id}/browse?${q}`);
  },

  // Files
  getFiles: (params: { library_id?: number; status?: string; page?: number; page_size?: number; sort_by?: string; sort_dir?: string }) => {
    const q = new URLSearchParams();
    if (params.library_id !== undefined) q.set("library_id", String(params.library_id));
    if (params.status)    q.set("status",    params.status);
    if (params.page)      q.set("page",      String(params.page));
    if (params.page_size) q.set("page_size", String(params.page_size));
    if (params.sort_by)   q.set("sort_by",   params.sort_by);
    if (params.sort_dir)  q.set("sort_dir",  params.sort_dir);
    return req<FilesResponse>(`/files?${q}`);
  },
  thumbnailUrl: (id: number) => `${BASE}/files/${id}/thumbnail`,
  streamUrl: (id: number) => `${BASE}/files/${id}/stream`,
  subtitleUrl: (id: number) => `${BASE}/files/${id}/subtitle`,
  searchFiles: (q: string, library_id?: number, limit = 50, exclude = false) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (library_id !== undefined) params.set("library_id", String(library_id));
    if (exclude) params.set("exclude", "true");
    return req<VideoSearchResult[]>(`/files/search?${params}`);
  },
  filterFilesByDetections: (params: { labels: string[]; min_confidence: number; exclude?: boolean; library_id?: number; page?: number; page_size?: number }) => {
    const q = new URLSearchParams({
      labels: params.labels.join(","),
      min_confidence: String(params.min_confidence),
      page: String(params.page ?? 1),
      page_size: String(params.page_size ?? 50),
    });
    if (params.library_id !== undefined) q.set("library_id", String(params.library_id));
    if (params.exclude) q.set("exclude", "true");
    return req<FilesResponse>(`/files/detections?${q}`);
  },
  triggerVideoScan: (library_id: number, reset = false) =>
    req<{ job_id: number; message: string }>(`/libraries/${library_id}/video-scan?reset=${reset}`, { method: "POST" }),

  // Jobs
  getJobs: (limit = 50) => req<Job[]>(`/jobs?limit=${limit}`),
  getJob: (id: number) => req<Job>(`/jobs/${id}`),
  checkFile: (id: number) => req<{ message: string }>(`/files/${id}/check`, { method: "POST" }),
  transcodeFile: (id: number, preset: string) =>
    req<{ message: string }>(`/files/${id}/transcode`, { method: "POST", body: JSON.stringify({ preset }) }),
  transcodeLibrary: (id: number, preset: string) =>
    req<{ message: string }>(`/libraries/${id}/transcode`, { method: "POST", body: JSON.stringify({ preset }) }),
  cancelJob: (id: number) => req<{ message: string }>(`/jobs/${id}/cancel`, { method: "POST" }),
  getJobLogs: (id: number) => req<JobLog[]>(`/jobs/${id}/logs`),
  jobsStreamUrl: () => `/api/jobs/stream`,
  clearJobHistory: () => req<void>("/jobs/history", { method: "DELETE" }),

  // Duplicates
  findDuplicates: (id: number, criteria: DuplicateCriteria) =>
    req<{ message: string }>(`/libraries/${id}/find-duplicates`, {
      method: "POST",
      body: JSON.stringify(criteria),
    }),
  getDuplicates: (id: number) => req<DuplicateGroup[]>(`/libraries/${id}/duplicates`),
  deleteDuplicates: (id: number, file_ids: number[]) =>
    req<void>(`/libraries/${id}/duplicates`, { method: "DELETE", body: JSON.stringify({ file_ids }) }),

  // Cleanup
  getCleanupFiles: (id: number, params: CleanupParams, fetchAll = false) => {
    const q = buildCleanupQuery(params);
    const qs = fetchAll ? (q ? `${q}&fetch_all=true` : "fetch_all=true") : q;
    return req<VideoFile[]>(`/libraries/${id}/cleanup?${qs}`);
  },
  deleteCleanupFiles: (id: number, file_ids: number[]) =>
    req<void>(`/libraries/${id}/cleanup`, { method: "DELETE", body: JSON.stringify({ file_ids }) }),

  // Originals
  getOriginals: (library_id?: number) => {
    const q = library_id !== undefined ? `?library_id=${library_id}` : "";
    return req<OriginalsSummary>(`/originals${q}`);
  },
  deleteOriginal: (path: string) =>
    req<void>("/originals/file", { method: "DELETE", body: JSON.stringify({ path }) }),
  restoreOriginal: (path: string) =>
    req<{ message: string; path: string }>("/originals/restore", { method: "POST", body: JSON.stringify({ path }) }),
  deleteLibraryOriginals: (library_id: number) =>
    req<void>(`/originals/library/${library_id}`, { method: "DELETE" }),

  // Filesystem
  fsBrowse: (path: string) => req<{ path: string; parent: string | null; dirs: string[] }>(`/fs/browse?path=${encodeURIComponent(path)}`),

  // Settings
  getSettings: () => req<{ max_concurrent_transcodes: number; tmdb_api_key: string; clip_model: string; nudenet_model: string; video_keyframes_per_video: number; scan_batch_size: number; opensubtitles_username: string; opensubtitles_password: string; subtitle_languages: string }>("/settings"),
  updateSettings: (body: { max_concurrent_transcodes?: number; tmdb_api_key?: string; clip_model?: string; nudenet_model?: string; video_keyframes_per_video?: number; scan_batch_size?: number; opensubtitles_username?: string; opensubtitles_password?: string; subtitle_languages?: string }) =>
    req<{ max_concurrent_transcodes: number; tmdb_api_key: string; clip_model: string; nudenet_model: string; video_keyframes_per_video: number; scan_batch_size: number; opensubtitles_username: string; opensubtitles_password: string; subtitle_languages: string }>("/settings", { method: "PATCH", body: JSON.stringify(body) }),

  // Identify
  identifyThumbnailUrl: (path: string) => `${BASE}/identify/thumbnail?path=${encodeURIComponent(path)}`,
  identifyFiles: (path: string) =>
    req<{ path: string; files: string[] }>(`/identify/files?path=${encodeURIComponent(path)}`),
  identifySearch: (body: { query: string; type: "movie" | "tv" }) =>
    req<SearchResult[]>("/identify/search", { method: "POST", body: JSON.stringify(body) }),
  identifyGetAllEpisodes: (tmdb_id: number) =>
    req<Episode[]>(`/identify/tv/${tmdb_id}/episodes`),
  identifyGetSeason: (tmdb_id: number, season_number: number) =>
    req<Episode[]>(`/identify/tv/${tmdb_id}/season/${season_number}`),
  identifyPreview: (body: {
    folder_path: string;
    type: "movie" | "tv";
    title: string;
    year: number | null;
    tmdb_id: number;
    mappings: FileMapping[];
  }) =>
    req<PreviewResponse>("/identify/preview", { method: "POST", body: JSON.stringify(body) }),
  identifyApply: (body: { file_ops: RenameOp[]; folder_ops: RenameOp[] }) =>
    req<ApplyResponse>("/identify/apply", { method: "POST", body: JSON.stringify(body) }),
};

// ── Image library types ──────────────────────────────────────────────────────

export interface ImageLibrary {
  id: number;
  name: string;
  path: string;
  created_at: string;
  last_scanned_at: string | null;
  image_count: number;
}

export interface ImageDetection {
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

export interface ImageSearchResult {
  image: ImageFile;
  score: number;
}

export interface VideoSearchResult {
  file: VideoFile;
  score: number;
}

export interface ImageScanRequest {
  run_phash: boolean;
  run_nudenet: boolean;
  run_clip: boolean;
  reset: boolean;
}

// ── Image library API ────────────────────────────────────────────────────────

export const imageApi = {
  listLibraries: () =>
    req<ImageLibrary[]>("/image-libraries"),

  createLibrary: (body: { name?: string; path: string }) =>
    req<ImageLibrary>("/image-libraries", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteLibrary: (id: number) =>
    req<void>(`/image-libraries/${id}`, { method: "DELETE" }),

  scanLibrary: (id: number, opts: ImageScanRequest) =>
    req<{ job_id: number }>(`/image-libraries/${id}/scan`, {
      method: "POST",
      body: JSON.stringify(opts),
    }),

  listImages: (params: {
    library_id?: number;
    status?: string;
    has_detections?: "any" | "exposed" | "none";
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_dir?: "asc" | "desc";
  }) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) p.set(k, String(v));
    });
    return req<ImagesResponse>(`/images?${p}`);
  },

  thumbnailUrl: (id: number) => `/api/images/${id}/thumbnail`,
  fullUrl: (id: number) => `/api/images/${id}/full`,

  quarantineImage: (id: number) =>
    req<{ message: string }>(`/images/${id}/quarantine`, { method: "POST" }),

  quarantineBulk: (ids: number[]) =>
    req<{ moved: number }>("/images/quarantine-bulk", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  listQuarantined: (page = 1, page_size = 50) =>
    req<ImagesResponse>(`/images/quarantined?page=${page}&page_size=${page_size}`),

  restoreImage: (id: number) =>
    req<{ message: string }>(`/images/${id}/restore`, { method: "POST" }),

  deleteImage: (id: number) =>
    req<void>(`/images/${id}`, { method: "DELETE" }),

  searchImages: (q: string, opts?: { limit?: number; exclude?: boolean; library_id?: number }) => {
    const p = new URLSearchParams({ q });
    if (opts?.limit) p.set("limit", String(opts.limit));
    if (opts?.exclude) p.set("exclude", "true");
    if (opts?.library_id) p.set("library_id", String(opts.library_id));
    return req<ImageSearchResult[]>(`/images/search?${p}`);
  },

  filterByDetections: (params: {
    labels: string[];
    min_confidence: number;
    exclude?: boolean;
    library_id?: number;
    page?: number;
    page_size?: number;
  }) => {
    const p = new URLSearchParams({
      labels: params.labels.join(","),
      min_confidence: String(params.min_confidence),
    });
    if (params.exclude) p.set("exclude", "true");
    if (params.library_id) p.set("library_id", String(params.library_id));
    if (params.page) p.set("page", String(params.page));
    if (params.page_size) p.set("page_size", String(params.page_size));
    return req<ImagesResponse>(`/images/detections?${p}`);
  },

  duplicates: (library_id?: number) => {
    const p = library_id ? `?library_id=${library_id}` : "";
    return req<number[][]>(`/images/duplicates${p}`);
  },
};

// ── AI model management ──────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  type: "clip" | "nudenet";
  name: string;
  description: string;
  size_mb: number;
  quality: string;
  downloaded: boolean;
  active: boolean;
  bundled: boolean;
}

export const modelsApi = {
  listModels: () => req<ModelInfo[]>("/models"),

  downloadClip: (model_id: string) =>
    req<{ job_id: number }>(`/models/clip/${model_id}/download`, { method: "POST" }),

  downloadNudenet: (model_id: string) =>
    req<{ job_id: number }>(`/models/nudenet/${model_id}/download`, { method: "POST" }),

  deleteClip: (model_id: string) =>
    req<void>(`/models/clip/${model_id}`, { method: "DELETE" }),

  deleteNudenet: (model_id: string) =>
    req<void>(`/models/nudenet/${model_id}`, { method: "DELETE" }),

  activateClip: (model_id: string) =>
    api.updateSettings({ clip_model: model_id }),

  activateNudenet: (model_id: string) =>
    api.updateSettings({ nudenet_model: model_id }),
};

// ── Subtitles ────────────────────────────────────────────────────────────────

export interface SubtitleFile {
  path: string;
  filename: string;
  relative_dir: string;
  has_subtitle: boolean;
  title: string;
  season: number | null;
  episode: number | null;
  year: number | null;
  media_type: string;
}

export interface SubtitleCandidate {
  subtitle_id: string;
  provider: string;
  language: string;
  release: string;
  score: number;
  hearing_impaired: boolean;
}

export const subtitlesApi = {
  scan: (path: string) =>
    req<SubtitleFile[]>("/subtitles/scan", { method: "POST", body: JSON.stringify({ path }) }),

  download: (path: string, languages?: string[]) =>
    req<{ job_id: number }>("/subtitles/download", { method: "POST", body: JSON.stringify({ path, languages }) }),

  searchFile: (file_path: string, languages?: string[]) =>
    req<SubtitleCandidate[]>("/subtitles/search-file", { method: "POST", body: JSON.stringify({ file_path, languages }) }),

  downloadOne: (file_path: string, provider: string, subtitle_id: string, language: string) =>
    req<{ ok: boolean }>("/subtitles/download-one", { method: "POST", body: JSON.stringify({ file_path, provider, subtitle_id, language }) }),

  streamUrl: (path: string) => `${BASE}/subtitles/stream?path=${encodeURIComponent(path)}`,
  vttUrl: (path: string) => `${BASE}/subtitles/vtt?path=${encodeURIComponent(path)}`,
};
