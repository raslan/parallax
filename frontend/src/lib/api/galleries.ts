import { BASE, req } from "./client";
import type { ArchiveInfo, GalleryEnqueuePayload, UrlListInfo } from "@/types/gallery";
import type { GalleryOptions } from "@/lib/schemas/gallery";

export const galleriesApi = {
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
  getGalleryArchive: () => req<ArchiveInfo>("/galleries/archive"),
  resetGalleryArchive: () => req<ArchiveInfo>("/galleries/archive/reset", { method: "POST" }),
  getGalleryUrlLists: () => req<{ lists: UrlListInfo[] }>("/galleries/urllists"),
  getGalleryUrlList: (name: string) =>
    req<{ name: string; text: string }>(`/galleries/urllists/${encodeURIComponent(name)}`),
  /** Create or overwrite a list. */
  putGalleryUrlList: (name: string, text: string) =>
    req<{ ok: true }>(`/galleries/urllists/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ text }),
    }),
  deleteGalleryUrlList: (name: string) =>
    req<void>(`/galleries/urllists/${encodeURIComponent(name)}`, { method: "DELETE" }),
  renameGalleryUrlList: (name: string, newName: string) =>
    req<{ name: string }>(`/galleries/urllists/${encodeURIComponent(name)}/rename`, {
      method: "POST",
      body: JSON.stringify({ name: newName }),
    }),
  galleryDlInfo: () =>
    req<{ installed: boolean; version: string | null; path: string | null }>("/galleries/gdl/info"),
  galleryDlUpdate: () => req<{ message: string }>("/galleries/gdl/update", { method: "POST" }),
  galleryYtdlImpersonateTargets: () =>
    req<{ targets: string[] }>("/galleries/ytdl/impersonate-targets"),
  galleriesSseUrl: () => `${BASE}/galleries/stream`,
};
