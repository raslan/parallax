import { BASE, req } from "./client";
import type { AudioFile } from "@/types/audio";

export const audioFilesApi = {
  list: (library_id: number) => req<AudioFile[]>(`/audio-files?library_id=${library_id}`),

  streamUrl: (id: number) => `${BASE}/audio-files/${id}/stream`,

  filesStreamUrl: (library_id?: number | null) =>
    `${BASE}/audio-files/stream${library_id != null ? `?library_id=${library_id}` : ""}`,
};
