import { BASE, req } from "./client";
import type { AudioFile } from "@/types/audio";

export const audioFilesApi = {
  list: (library_id: number) => req<AudioFile[]>(`/audio-files?library_id=${library_id}`),

  deleteFiles: (fileIds: number[], opts?: { keep_original?: boolean }) =>
    req<void>(`/audio-files/delete`, {
      method: "POST",
      body: JSON.stringify({ file_ids: fileIds, keep_original: opts?.keep_original ?? true }),
    }),

  streamUrl: (id: number) => `${BASE}/audio-files/${id}/stream`,

  filesStreamUrl: (library_id?: number | null) =>
    `${BASE}/audio-files/stream${library_id != null ? `?library_id=${library_id}` : ""}`,
};
