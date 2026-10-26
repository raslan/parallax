import type { GalleryOptions } from "@/lib/schemas/gallery";

export const VIDEO_QUALITIES = [
  { id: "best", label: "Best" },
  { id: "2160", label: "4K" },
  { id: "1440", label: "1440p" },
  { id: "1080", label: "1080p" },
  { id: "720", label: "720p" },
  { id: "480", label: "480p" },
  { id: "360", label: "360p" },
] as const;

export const VIDEO_CODECS = [
  { id: "auto", label: "Auto" },
  { id: "h264", label: "H.264" },
  { id: "hevc", label: "H.265" },
  { id: "av1", label: "AV1" },
  { id: "vp9", label: "VP9" },
];

/** One-line summary of the current yt-dlp output, shown on the trigger button. */
export function ytdlSummary(o: GalleryOptions): string {
  if (o.ytAudioOnly) return `Audio · ${o.ytCodec.toUpperCase()}`;
  const q = VIDEO_QUALITIES.find((x) => x.id === o.ytQuality)?.label ?? o.ytQuality;
  const c = VIDEO_CODECS.find((x) => x.id === o.ytCodec)?.label ?? o.ytCodec;
  return `${q} · ${c}`;
}
