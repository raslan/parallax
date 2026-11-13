import { req } from "./client";
import { settingsApi } from "./settings";
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

export const speechModelsApi = {
  list: () => req<SubtitlePack[]>("/speech-models"),
  install: (id: string) =>
    req<{ job_id: number }>(`/speech-models/${encodeURIComponent(id)}/install`, {
      method: "POST",
    }),
  remove: (id: string) =>
    req<void>(`/speech-models/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Choose the model Generate uses, globally (the same way NudeNet's model is chosen). */
  activate: (id: string) => settingsApi.updateSettings({ speech_model: id }),
};
