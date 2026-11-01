import { BASE, req } from "./client";
import type {
  FileDetails,
  PruneDeleteResult,
  PruneFile,
  PruneFolder,
  ScanState,
} from "@/types/prune";

const q = (path: string) => `path=${encodeURIComponent(path)}`;

export const pruneApi = {
  getPruneRoot: () => req<{ root: string | null }>("/prune/root"),
  putPruneRoot: (path: string) =>
    req<{ root: string | null }>("/prune/root", { method: "PUT", body: JSON.stringify({ path }) }),
  startPruneScan: () => req<ScanState>("/prune/scan", { method: "POST" }),
  getPruneScan: () => req<ScanState>("/prune/scan"),
  getPruneFolder: (path: string) => req<PruneFolder>(`/prune/folder?${q(path)}`),
  getPruneFiles: (path: string) => req<PruneFile[]>(`/prune/files?${q(path)}`),
  getPruneDetails: (paths: string[]) =>
    req<{ details: Record<string, FileDetails | null> }>("/prune/details", {
      method: "POST",
      body: JSON.stringify({ paths }),
    }),
  pruneDelete: (paths: string[]) =>
    req<PruneDeleteResult>("/prune/delete", { method: "POST", body: JSON.stringify({ paths }) }),
  pruneDeleteFolder: (path: string) =>
    req<void>("/prune/delete-folder", { method: "POST", body: JSON.stringify({ path }) }),
  pruneThumbnailUrl: (path: string) => `${BASE}/prune/thumbnail?${q(path)}`,
  pruneFileUrl: (path: string) => `${BASE}/prune/file?${q(path)}`,
  pruneAudioUrl: (path: string) => `${BASE}/prune/audio?${q(path)}`,
};
