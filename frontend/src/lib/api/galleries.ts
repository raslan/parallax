import { BASE, req } from "./client";
import type { GalleryDownload, GalleryEnqueuePayload } from "@/types/gallery";
import type { GalleryOptions } from "@/lib/schemas/gallery";

export const galleriesApi = {
  getGalleries: () => req<GalleryDownload[]>("/galleries"),
  enqueueGalleries: (body: GalleryEnqueuePayload) =>
    req<{ ids: number[] }>("/galleries", { method: "POST", body: JSON.stringify(body) }),
  deleteGallery: (id: number) => req<void>(`/galleries/${id}`, { method: "DELETE" }),
  retryFailedGalleries: () => req<{ ids: number[] }>("/galleries/retry-failed", { method: "POST" }),
  stopAllGalleries: () => req<{ stopped: number }>("/galleries/stop-all", { method: "POST" }),
  clearGalleries: (statuses: string[]) =>
    req<{ cleared: number }>("/galleries/clear", {
      method: "POST",
      body: JSON.stringify({ statuses }),
    }),
  getGalleryOptions: () => req<GalleryOptions>("/galleries/options"),
  putGalleryOptions: (opts: GalleryOptions) =>
    req<{ ok: true }>("/galleries/options", { method: "PUT", body: JSON.stringify(opts) }),
  getGalleryUrlfile: () => req<{ text: string }>("/galleries/urlfile"),
  putGalleryUrlfile: (text: string) =>
    req<{ ok: true }>("/galleries/urlfile", { method: "PUT", body: JSON.stringify({ text }) }),
  galleryDlInfo: () =>
    req<{ installed: boolean; version: string | null; path: string | null }>("/galleries/gdl/info"),
  galleryDlUpdate: () => req<{ message: string }>("/galleries/gdl/update", { method: "POST" }),
  galleriesSseUrl: () => `${BASE}/galleries/stream`,
};
