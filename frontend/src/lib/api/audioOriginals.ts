import { req } from "./client";
import type { AudioOriginalsSummary } from "@/types/audio";

export const audioOriginalsApi = {
  list: (library_id?: number) => {
    const q = library_id !== undefined ? `?library_id=${library_id}` : "";
    return req<AudioOriginalsSummary>(`/audio-originals${q}`);
  },
  restore: (path: string) =>
    req<{ message: string; path: string }>("/audio-originals/restore", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  restoreBatch: (paths: string[]) =>
    req<{ restored: number; failed: { path: string; error: string }[] }>(
      "/audio-originals/restore-batch",
      { method: "POST", body: JSON.stringify({ paths }) },
    ),
  deleteFile: (path: string) =>
    req<void>("/audio-originals/file", { method: "DELETE", body: JSON.stringify({ path }) }),
  deleteLibraryOriginals: (library_id: number) =>
    req<void>(`/audio-originals/library/${library_id}`, { method: "DELETE" }),
};
