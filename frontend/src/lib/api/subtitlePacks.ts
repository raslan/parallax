import { req } from "./client";
import type { SubtitlePack } from "@/types/subtitlePack";

export const subtitlePacksApi = {
  list: () => req<SubtitlePack[]>("/subtitle-packs"),
  install: (lang: string) =>
    req<{ job_id: number }>(`/subtitle-packs/${encodeURIComponent(lang)}/install`, {
      method: "POST",
    }),
  remove: (lang: string) =>
    req<void>(`/subtitle-packs/${encodeURIComponent(lang)}`, { method: "DELETE" }),
};
