import { req } from "./client";
import type { Library, Stats, BrowseResponse } from "@/types/library";

export const librariesApi = {
  getLibraries: () => req<Library[]>("/libraries"),
  getStats: () => req<Stats>("/libraries/stats"),
  createLibrary: (body: { name: string; path: string; split_into_sublibraries?: boolean }) =>
    req<Library[]>("/libraries", { method: "POST", body: JSON.stringify(body) }),
  deleteLibrary: (id: number, delete_leftovers = false) =>
    req<void>(`/libraries/${id}?delete_leftovers=${delete_leftovers}`, { method: "DELETE" }),
  libraryLeftovers: (id: number) =>
    req<{ has_leftovers: boolean; dir_name: string; count: number; total_bytes: number }>(
      `/libraries/${id}/leftovers`,
    ),
  scanLibrary: (id: number) =>
    req<{ message: string }>(`/libraries/${id}/scan`, { method: "POST" }),
  checkLibrary: (id: number) =>
    req<{ message: string }>(`/libraries/${id}/check`, { method: "POST" }),
  browseLibrary: (
    id: number,
    path: string,
    status?: string,
    sort_by?: string,
    sort_dir?: string,
  ) => {
    const q = new URLSearchParams({ path });
    if (status) q.set("status", status);
    if (sort_by) q.set("sort_by", sort_by);
    if (sort_dir) q.set("sort_dir", sort_dir);
    return req<BrowseResponse>(`/libraries/${id}/browse?${q}`);
  },
};
