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

export interface Library {
  id: number;
  name: string;
  path: string;
  scan_automatically: boolean;
  auto_transcode_corrupt: boolean;
  created_at: string;
  last_scanned_at: string | null;
}

export interface VideoFile {
  id: number;
  library_id: number;
  path: string;
  filename: string;
  size: number;
  duration: number | null;
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
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
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

export const api = {
  // Libraries
  getLibraries: () => req<Library[]>("/libraries"),
  getStats: () => req<Stats>("/libraries/stats"),
  createLibrary: (body: { name: string; path: string; scan_automatically: boolean; auto_transcode_corrupt: boolean }) =>
    req<Library>("/libraries", { method: "POST", body: JSON.stringify(body) }),
  deleteLibrary: (id: number) => req<void>(`/libraries/${id}`, { method: "DELETE" }),
  scanLibrary: (id: number) => req<{ message: string }>(`/libraries/${id}/scan`, { method: "POST" }),
  browseLibrary: (id: number, path: string, status?: string) => {
    const q = new URLSearchParams({ path });
    if (status) q.set("status", status);
    return req<BrowseResponse>(`/libraries/${id}/browse?${q}`);
  },

  // Files
  getFiles: (params: { library_id?: number; status?: string; page?: number; page_size?: number }) => {
    const q = new URLSearchParams();
    if (params.library_id !== undefined) q.set("library_id", String(params.library_id));
    if (params.status) q.set("status", params.status);
    if (params.page) q.set("page", String(params.page));
    if (params.page_size) q.set("page_size", String(params.page_size));
    return req<FilesResponse>(`/files?${q}`);
  },
  thumbnailUrl: (id: number) => `${BASE}/files/${id}/thumbnail`,
  streamUrl: (id: number) => `${BASE}/files/${id}/stream`,

  // Jobs
  getJobs: (limit = 50) => req<Job[]>(`/jobs?limit=${limit}`),
  cancelJob: (id: number) => req<{ message: string }>(`/jobs/${id}/cancel`, { method: "POST" }),
  clearJobHistory: () => req<void>("/jobs/history", { method: "DELETE" }),
};
