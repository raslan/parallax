import { BASE, req } from "./client";
import type { DownloadItem, DownloadRequest } from "@/types/download";

export const downloadsApi = {
  getDownloads: () => req<DownloadItem[]>("/downloads"),
  enqueueDownloads: (body: DownloadRequest) =>
    req<{ ids: number[] }>("/downloads", { method: "POST", body: JSON.stringify(body) }),
  deleteDownload: (id: number) => req<void>(`/downloads/${id}`, { method: "DELETE" }),
  retryAllFailedDownloads: () =>
    req<{ ids: number[] }>("/downloads/retry-failed", { method: "POST" }),
  stopAllDownloads: () => req<{ stopped: number }>("/downloads/stop-all", { method: "POST" }),
  deleteDownloadWithFile: (id: number) =>
    req<void>(`/downloads/${id}?delete_file=true`, { method: "DELETE" }),
  downloadStreamUrl: (id: number) => `${BASE}/downloads/${id}/stream`,
  downloadsSseUrl: () => `${BASE}/downloads/stream`,
};
