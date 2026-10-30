import { z } from "zod";

/** gallery-dl options — flat, mirrors backend `GalleryOptions` (Pydantic). */
export const galleryOptionsSchema = z.object({
  baseDir: z.string().default(""),
  maxParallel: z.number().int().min(1).max(5).default(2),
  retries: z.preprocess(
    (v) => (typeof v === "number" && Number.isNaN(v) ? undefined : v),
    z.number().int().min(0).max(20).default(3),
  ),
  httpTimeout: z.preprocess(
    (v) => (typeof v === "number" && Number.isNaN(v) ? undefined : v),
    z.number().int().min(1).max(600).default(30),
  ),
  typeVideo: z.boolean().default(true),
  typeAudio: z.boolean().default(false),
  typeImage: z.boolean().default(false),
  typeAny: z.boolean().default(false),
  maxSizeValue: z.number().min(0).nullable().default(null),
  maxSizeUnit: z.enum(["K", "M", "G", "T"]).default("M"),
  minSizeValue: z.number().min(0).nullable().default(null),
  minSizeUnit: z.enum(["K", "M", "G", "T"]).default("M"),
  stopAfterExisting: z.number().int().min(1).nullable().default(null),
  useArchive: z.boolean().default(true),
  archivePath: z.string().default(""),
  range: z.string().default(""),
  browser: z.string().default(""),
  userAgent: z.string().default(""),
  limitRate: z.string().default(""),
  sleepRequest: z.string().default(""),
  filenameTemplate: z.string().default(""),
  extraArgs: z.string().default(""),
  inputMode: z.enum(["paste", "file"]).default("paste"),
  urlList: z.string().max(64).default("default"), // selected URL list in file mode
  // yt-dlp (ytdl backend) — same vocabulary as the Downloads options form.
  ytAudioOnly: z.boolean().default(false),
  ytQuality: z.enum(["best", "2160", "1440", "1080", "720", "480", "360"]).default("best"),
  ytCodec: z.string().default("auto"), // video: auto/h264/hevc/av1/vp9 · audio: mp3/m4a/opus
  ytConcurrentFragments: z.preprocess(
    (v) => (typeof v === "number" && Number.isNaN(v) ? undefined : v),
    z.number().int().min(1).max(64).default(4),
  ),
  ytDownloadSubs: z.boolean().default(false),
  ytSubLangs: z.string().default("en"),
  ytImpersonate: z.string().default(""),
  ytRefererMode: z.enum(["none", "site", "url", "custom"]).default("none"),
  ytReferer: z.string().default(""),
  ytThrottledRateValue: z
    .string()
    .regex(/^(\d+\.?\d*|\.\d+)?$/, "number only")
    .default(""),
  ytThrottledRateUnit: z.enum(["K", "M", "G"]).default("M"),
  ytExtraArgs: z.string().default(""),
});

export type GalleryOptions = z.infer<typeof galleryOptionsSchema>;

export const GALLERY_OPTIONS_DEFAULTS: GalleryOptions = galleryOptionsSchema.parse({});
