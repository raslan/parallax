import { z } from "zod";
import type { Settings } from "@/types/settings";

/**
 * Per-tab Settings forms. Each tab owns one of these schemas + its own
 * `useForm`; `formState.isDirty` drives the Save button and `onSubmit` PATCHes
 * only that tab's slice of `UpdateSettingsBody`.
 */

export const transcodingSchema = z.object({
  maxConcurrent: z.number().int().min(1).max(8),
});
export type TranscodingForm = z.infer<typeof transcodingSchema>;

export const credentialsSchema = z.object({
  tmdbKey: z.string(),
  subtitleLangs: z.array(z.string()).min(1, "Pick at least one language"),
});
export type CredentialsForm = z.infer<typeof credentialsSchema>;

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
});
export const seedCredentials = (s: Settings): CredentialsForm => ({
  tmdbKey: s.tmdb_api_key,
  subtitleLangs: (s.subtitle_languages || "en")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean),
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
