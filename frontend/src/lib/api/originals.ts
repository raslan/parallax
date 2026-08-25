import { req } from "./client";
import type { OriginalsSummary } from "@/types/original";

export const originalsApi = {
  getOriginals: (library_id?: number) => {
    const q = library_id !== undefined ? `?library_id=${library_id}` : "";
    return req<OriginalsSummary>(`/originals${q}`);
  },
  deleteOriginal: (path: string) =>
    req<void>("/originals/file", { method: "DELETE", body: JSON.stringify({ path }) }),
  restoreOriginal: (path: string) =>
    req<{ message: string; path: string }>("/originals/restore", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  restoreOriginalsBatch: (paths: string[]) =>
    req<{ restored: number; failed: { path: string; error: string }[] }>(
      "/originals/restore-batch",
      {
        method: "POST",
        body: JSON.stringify({ paths }),
      },
    ),
  deleteLibraryOriginals: (library_id: number) =>
    req<void>(`/originals/library/${library_id}`, { method: "DELETE" }),
};
