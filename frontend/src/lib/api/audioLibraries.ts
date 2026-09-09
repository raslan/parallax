import { req } from "./client";
import type { AudioLibrary } from "@/types/audio";

export const audioLibrariesApi = {
  listLibraries: () => req<AudioLibrary[]>("/audio-libraries"),

  createLibrary: (body: { name?: string; path: string; split_into_sublibraries?: boolean }) =>
    req<AudioLibrary[]>("/audio-libraries", { method: "POST", body: JSON.stringify(body) }),

  updateLibrary: (id: number, body: { name?: string; scan_automatically?: boolean }) =>
    req<AudioLibrary>(`/audio-libraries/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  deleteLibrary: (id: number, delete_leftovers = false) =>
    req<void>(`/audio-libraries/${id}?delete_leftovers=${delete_leftovers}`, { method: "DELETE" }),

  libraryLeftovers: (id: number) =>
    req<{ has_leftovers: boolean; dir_name: string; count: number; total_bytes: number }>(
      `/audio-libraries/${id}/leftovers`,
    ),

  scanLibrary: (id: number) =>
    req<{ job_id: number }>(`/audio-libraries/${id}/scan`, { method: "POST" }),
};
