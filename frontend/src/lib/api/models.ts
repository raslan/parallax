import { req } from "./client";
import { settingsApi } from "./settings";
import type { ModelInfo, ActiveModelDownload } from "@/types/model";

export const modelsApi = {
  listModels: () => req<ModelInfo[]>("/models"),
  getActiveDownload: () => req<ActiveModelDownload | null>("/models/active-download"),

  downloadNudenet: (model_id: string) =>
    req<{ job_id: number }>(`/models/nudenet/${model_id}/download`, { method: "POST" }),

  deleteNudenet: (model_id: string) =>
    req<void>(`/models/nudenet/${model_id}`, { method: "DELETE" }),

  activateNudenet: (model_id: string) => settingsApi.updateSettings({ nudenet_model: model_id }),

  downloadWhisper: (model_id: string) =>
    req<{ job_id: number }>(`/models/whisper/${model_id}/download`, { method: "POST" }),

  deleteWhisper: (model_id: string) =>
    req<void>(`/models/whisper/${model_id}`, { method: "DELETE" }),

  activateWhisper: (model_id: string) =>
    req<{ active: string }>(`/models/whisper/${model_id}/activate`, { method: "POST" }),
};
