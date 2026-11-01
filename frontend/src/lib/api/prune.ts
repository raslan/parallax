import { BASE, req } from "./client";
import type {
  FileDetails,
  PruneDeleteResult,
  PruneFile,
  PruneFolder,
  ScanState,
} from "@/types/prune";
import type { StreamPrepareStatus } from "@/types/stream";

const q = (path: string) => `path=${encodeURIComponent(path)}`;

export const pruneApi = {
  getPruneRoot: () => req<{ root: string | null }>("/prune/root"),
  putPruneRoot: (path: string) =>
    req<{ root: string | null }>("/prune/root", { method: "PUT", body: JSON.stringify({ path }) }),
  /** Without `force` the backend reuses a finished scan of the same root. */
  startPruneScan: (force = false) =>
    req<ScanState>(`/prune/scan${force ? "?force=true" : ""}`, { method: "POST" }),
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
  /** `onlyIfEmpty` deletes only a still-empty folder (409 if it gained entries). */
  pruneDeleteFolder: (path: string, onlyIfEmpty = false) =>
    req<void>("/prune/delete-folder", {
      method: "POST",
      body: JSON.stringify({ path, only_if_empty: onlyIfEmpty }),
    }),
  /** Sandboxed twins of `streamApi.prepare/status`: the path is checked against the chosen folder. */
  pruneStreamPrepare: (path: string) =>
    req<StreamPrepareStatus>("/prune/stream/prepare", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  pruneStreamPrepareStatus: (path: string) =>
    req<StreamPrepareStatus>(`/prune/stream/prepare-status?${q(path)}`),
  pruneThumbnailUrl: (path: string) => `${BASE}/prune/thumbnail?${q(path)}`,
  pruneFileUrl: (path: string) => `${BASE}/prune/file?${q(path)}`,
  pruneAudioUrl: (path: string) => `${BASE}/prune/audio?${q(path)}`,
};
