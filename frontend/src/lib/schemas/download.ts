import { z } from "zod";

/** yt-dlp download options form (the Downloads page right-hand panel). */
export const downloadOptionsSchema = z.object({
  audioOnly: z.boolean(),
  quality: z.string(),
  codec: z.string(), // video: auto/h264/hevc/av1/vp9 · audio: mp3/m4a/opus
  trimStart: z
    .string()
    .regex(/^(\d{1,2}:)?\d{1,2}:\d{2}$|^$/, "Use HH:MM:SS or MM:SS")
    .default(""),
  trimEnd: z
    .string()
    .regex(/^(\d{1,2}:)?\d{1,2}:\d{2}$|^$/, "Use HH:MM:SS or MM:SS")
    .default(""),
  outputDir: z.string().default(""),
  downloadSubs: z.boolean(),
  subLangs: z.string(),
  extraArgs: z.string().default(""),
  impersonate: z.string().default(""),
});

export type DownloadOptions = z.infer<typeof downloadOptionsSchema>;
