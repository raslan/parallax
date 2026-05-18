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
  scan_automatically: boolean;
  auto_transcode_corrupt: boolean;
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

export const api = {
  // Libraries
  getLibraries: () => req<Library[]>("/libraries"),
  getStats: () => req<Stats>("/libraries/stats"),
  createLibrary: (body: { name: string; path: string; scan_automatically: boolean; auto_transcode_corrupt: boolean }) =>
    req<Library>("/libraries", { method: "POST", body: JSON.stringify(body) }),
  deleteLibrary: (id: number) => req<void>(`/libraries/${id}`, { method: "DELETE" }),
  scanLibrary: (id: number) => req<{ message: string }>(`/libraries/${id}/scan`, { method: "POST" }),
  checkLibrary: (id: number) => req<{ message: string }>(`/libraries/${id}/check`, { method: "POST" }),
  corruptLibrary: (id: number) => req<{ message: string }>(`/libraries/${id}/corrupt`, { method: "POST" }),
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

  // Jobs
  getJobs: (limit = 50) => req<Job[]>(`/jobs?limit=${limit}`),
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
  findDuplicates: (id: number) => req<{ message: string }>(`/libraries/${id}/find-duplicates`, { method: "POST" }),
  getDuplicates: (id: number) => req<DuplicateGroup[]>(`/libraries/${id}/duplicates`),
  deleteDuplicates: (id: number, file_ids: number[]) =>
    req<void>(`/libraries/${id}/duplicates`, { method: "DELETE", body: JSON.stringify({ file_ids }) }),

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

  // Settings
  getSettings: () => req<{ max_concurrent_transcodes: number }>("/settings"),
  updateSettings: (body: { max_concurrent_transcodes: number }) =>
    req<{ max_concurrent_transcodes: number }>("/settings", { method: "PATCH", body: JSON.stringify(body) }),
};
