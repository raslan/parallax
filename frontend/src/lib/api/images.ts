import { req } from "./client";
import type { ImageLibrary, ImagesResponse, ImageScanRequest } from "@/types/image";

export const imageApi = {
  listLibraries: () => req<ImageLibrary[]>("/image-libraries"),

  createLibrary: (body: { name?: string; path: string }) =>
    req<ImageLibrary>("/image-libraries", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteLibrary: (id: number, delete_leftovers = false) =>
    req<void>(`/image-libraries/${id}?delete_leftovers=${delete_leftovers}`, { method: "DELETE" }),
  libraryLeftovers: (id: number) =>
    req<{ has_leftovers: boolean; dir_name: string; count: number; total_bytes: number }>(
      `/image-libraries/${id}/leftovers`,
    ),

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

  thumbnailUrl: (id: number, version?: string | number | null) =>
    `/api/images/${id}/thumbnail${version ? `?v=${encodeURIComponent(String(version))}` : ""}`,
  fullUrl: (id: number) => `/api/images/${id}/full`,
  streamUrl: (library_id?: number | null) =>
    `/api/images/stream${library_id != null ? `?library_id=${library_id}` : ""}`,

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

  restoreBulk: (ids: number[]) =>
    req<{ restored: number }>("/images/restore-bulk", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  deleteImage: (id: number) => req<void>(`/images/${id}`, { method: "DELETE" }),

  deleteBulk: (ids: number[]) =>
    req<{ deleted: number }>("/images/delete-bulk", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

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

  duplicates: (library_id?: number, threshold?: number) => {
    const params = new URLSearchParams();
    if (library_id != null) params.set("library_id", String(library_id));
    if (threshold != null) params.set("threshold", String(threshold));
    const p = params.toString() ? `?${params}` : "";
    return req<number[][]>(`/images/duplicates${p}`);
  },
};
