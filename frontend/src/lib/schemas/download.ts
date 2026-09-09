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
  concurrentFragments: z.coerce.number().int().min(1).max(64).default(4),
  // none = no header · site = origin root · url = the video's own URL · custom = literal (uses `referer`)
  refererMode: z.enum(["none", "site", "url", "custom"]).default("none"),
  referer: z.string().default(""), // literal Referer, used only when refererMode === "custom"
  throttledRateValue: z
    .string()
    .regex(/^\d*\.?\d*$/, "number only")
    .default(""),
  throttledRateUnit: z.enum(["K", "M", "G"]).default("M"),
  groupByUploader: z.boolean().default(false), // nest each file in an uploader/ subfolder
});

export type DownloadOptions = z.infer<typeof downloadOptionsSchema>;
