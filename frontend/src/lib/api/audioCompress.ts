import { req } from "./client";
import type { AudioCodec, AudioFile } from "@/types/audio";

export const audioCompressApi = {
  codecs: () => req<AudioCodec[]>("/audio-compress/codecs"),

  libraryFiles: (library_id: number) =>
    req<AudioFile[]>(`/audio-compress/library-files?library_id=${library_id}`),

  start: (body: { file_ids: number[]; codec: string; bitrate: number; keep_original: boolean }) =>
    req<{ job_id: number }>("/audio-compress/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
