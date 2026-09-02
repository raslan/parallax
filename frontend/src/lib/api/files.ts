import { BASE, req } from "./client";
import type { FilesResponse } from "@/types/file";

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
  triggerPhashScan: (library_id: number, reset = false) =>
    req<{ job_id: number; message: string }>(`/libraries/${library_id}/phash-scan?reset=${reset}`, {
      method: "POST",
    }),
  filesStreamUrl: (library_id?: number | null) =>
    `${BASE}/files/stream${library_id != null ? `?library_id=${library_id}` : ""}`,
};
