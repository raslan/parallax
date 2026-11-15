import { z } from "zod";
import type { Settings } from "@/types/settings";

/**
 * Per-tab Settings forms. Each tab owns one of these schemas + its own
 * `useForm`; `formState.isDirty` drives the Save button and `onSubmit` PATCHes
 * only that tab's slice of `UpdateSettingsBody`.
 */

export const transcodingSchema = z.object({
  maxConcurrent: z.number().int().min(1).max(32),
  maxConcurrentAudio: z.number().int().min(1).max(32),
});
export type TranscodingForm = z.infer<typeof transcodingSchema>;

export const generalSettingsSchema = z.object({
  maxConcurrentJobs: z.number().int().min(1).max(32),
});
export type GeneralSettingsForm = z.infer<typeof generalSettingsSchema>;

export const credentialsSchema = z.object({
  tmdbKey: z.string(),
});
export type CredentialsForm = z.infer<typeof credentialsSchema>;

export const subtitlesSchema = z.object({
  subtitleLangs: z.array(z.string()).min(1, "Pick at least one language"),
  subtitleSyncEngine: z.enum(["alass", "ffsubsync"]),
  translateDropHi: z.boolean(),
});
export type SubtitlesForm = z.infer<typeof subtitlesSchema>;

export const hardwareSchema = z.object({
  gpuEnabled: z.boolean(),
  /** 0 = every detected card. */
  gpuCount: z.number().int().min(0).max(64),
});
export type HardwareForm = z.infer<typeof hardwareSchema>;

export const aiModelsSchema = z.object({
  scanBatchSize: z.number().int().min(1).max(32),
  scanPrefetch: z.number().int().min(1).max(20),
});
export type AiModelsForm = z.infer<typeof aiModelsSchema>;

export const downloadsSettingsSchema = z.object({
  downloadDir: z.string().trim().min(1, "Directory is required"),
  maxConcurrentDownloads: z.number().int().min(1).max(5),
  ytdlpChannel: z.enum(["stable", "nightly"]),
});
export type DownloadsSettingsForm = z.infer<typeof downloadsSettingsSchema>;

/** Seed helpers — map a fetched `Settings` onto each tab's form shape. */
export const seedTranscoding = (s: Settings): TranscodingForm => ({
  maxConcurrent: s.max_concurrent_transcodes,
  maxConcurrentAudio: s.max_concurrent_audio_transcodes,
});
export const seedGeneral = (s: Settings): GeneralSettingsForm => ({
  maxConcurrentJobs: s.max_concurrent_jobs,
});
export const seedCredentials = (s: Settings): CredentialsForm => ({
  tmdbKey: s.tmdb_api_key,
});
export const seedSubtitles = (s: Settings): SubtitlesForm => ({
  subtitleLangs: (s.subtitle_languages || "en")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean),
  subtitleSyncEngine: s.subtitle_sync_engine === "ffsubsync" ? "ffsubsync" : "alass",
  translateDropHi: s.subtitle_translate_drop_hi ?? false,
});
export const seedHardware = (s: Settings): HardwareForm => ({
  gpuEnabled: s.gpu_accel_enabled ?? true,
  gpuCount: s.gpu_accel_count ?? 0,
});
export const seedAiModels = (s: Settings): AiModelsForm => ({
  scanBatchSize: s.scan_batch_size ?? 4,
  scanPrefetch: s.scan_prefetch ?? 4,
});
export const seedDownloads = (s: Settings): DownloadsSettingsForm => ({
  downloadDir: s.download_dir ?? "/media/downloads",
  maxConcurrentDownloads: s.max_concurrent_downloads ?? 2,
  ytdlpChannel: s.ytdlp_channel === "nightly" ? "nightly" : "stable",
});
