import { BASE, req } from "./client";
import type { FilesResponse, VideoSearchResult } from "@/types/file";

export const filesApi = {
  getFiles: (params: {
    library_id?: number;
    status?: string;
    page?: number;
    page_size?: number;
    sort_by?: string;
    sort_dir?: string;
  }) => {
    const q = new URLSearchParams();
    if (params.library_id !== undefined) q.set("library_id", String(params.library_id));
    if (params.status) q.set("status", params.status);
    if (params.page) q.set("page", String(params.page));
    if (params.page_size) q.set("page_size", String(params.page_size));
    if (params.sort_by) q.set("sort_by", params.sort_by);
    if (params.sort_dir) q.set("sort_dir", params.sort_dir);
    return req<FilesResponse>(`/files?${q}`);
  },
  thumbnailUrl: (id: number, version?: string | number | null) =>
    `${BASE}/files/${id}/thumbnail${version ? `?v=${encodeURIComponent(String(version))}` : ""}`,
  streamUrl: (id: number) => `${BASE}/files/${id}/stream`,
  subtitleTracksUrl: (id: number) => `${BASE}/files/${id}/subtitle-tracks`,
  searchFiles: (q: string, library_id?: number, limit = 50, exclude = false) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (library_id !== undefined) params.set("library_id", String(library_id));
    if (exclude) params.set("exclude", "true");
    return req<VideoSearchResult[]>(`/files/search?${params}`);
  },
  filterFilesByDetections: (params: {
    labels: string[];
    min_confidence: number;
    exclude?: boolean;
    library_id?: number;
    page?: number;
    page_size?: number;
  }) => {
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
    req<{ job_id: number; message: string }>(`/libraries/${library_id}/video-scan?reset=${reset}`, {
      method: "POST",
    }),
  triggerPhashScan: (library_id: number, reset = false) =>
    req<{ job_id: number; message: string }>(`/libraries/${library_id}/phash-scan?reset=${reset}`, {
      method: "POST",
    }),
  checkFile: (id: number) => req<{ message: string }>(`/files/${id}/check`, { method: "POST" }),
  filesStreamUrl: (library_id?: number | null) =>
    `${BASE}/files/stream${library_id != null ? `?library_id=${library_id}` : ""}`,
};
