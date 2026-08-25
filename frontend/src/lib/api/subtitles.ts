import { BASE, req } from "./client";
import type { SubtitleFile, SubtitleCandidate } from "@/types/subtitle";

export const subtitlesApi = {
  scan: (path: string) =>
    req<SubtitleFile[]>("/subtitles/scan", { method: "POST", body: JSON.stringify({ path }) }),

  download: (path: string, languages?: string[]) =>
    req<{ job_id: number }>("/subtitles/download", {
      method: "POST",
      body: JSON.stringify({ path, languages }),
    }),

  searchFile: (
    file_path: string,
    languages?: string[],
    opts?: {
      query?: string;
      year?: number;
      media_type?: string;
      season?: number;
      episode?: number;
      provider?: string;
    },
  ) =>
    req<SubtitleCandidate[]>("/subtitles/search-file", {
      method: "POST",
      body: JSON.stringify({ file_path, languages, ...opts }),
    }),

  downloadOne: (file_path: string, provider: string, subtitle_id: string, language: string) =>
    req<{ ok: boolean }>("/subtitles/download-one", {
      method: "POST",
      body: JSON.stringify({ file_path, provider, subtitle_id, language }),
    }),

  streamUrl: (path: string) => `${BASE}/subtitles/stream?path=${encodeURIComponent(path)}`,
  vttUrl: (path: string) => `${BASE}/subtitles/vtt?path=${encodeURIComponent(path)}`,
  tracksUrl: (path: string) => `${BASE}/subtitles/tracks?path=${encodeURIComponent(path)}`,

  transcribeFile: (file_path: string, model_id?: string, language?: string) =>
    req<{ job_id: number }>("/subtitles/transcribe-file", {
      method: "POST",
      body: JSON.stringify({ file_path, model_id, language }),
    }),

  transcribeBulk: (path: string, model_id?: string, language?: string) =>
    req<{ job_id: number }>("/subtitles/transcribe-bulk", {
      method: "POST",
      body: JSON.stringify({ path, model_id, language }),
    }),
};
