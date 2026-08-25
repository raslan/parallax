import { req } from "./client";
import type { CompressCodec } from "@/types/compress";
import type { VideoFile } from "@/types/file";

export const compressApi = {
  codecs: () => req<CompressCodec[]>("/compress/codecs"),

  libraryFiles: (library_id: number) =>
    req<VideoFile[]>(`/compress/library-files?library_id=${library_id}`),

  start: (body: {
    file_ids: number[];
    codec: string;
    crf: number;
    speed: string;
    keep_original: boolean;
  }) => req<{ job_id: number }>("/compress/start", { method: "POST", body: JSON.stringify(body) }),
};
