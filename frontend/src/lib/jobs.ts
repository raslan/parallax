import type { Job } from "@/types/job";

const TYPE_LABEL: Record<string, string> = {
  scan: "Scan",
  image_scan: "Image scan",
  image_duplicates: "Image pHash",
  image_content_scan: "Content scan",
  phash_scan: "pHash scan",
  transcode: "Transcode",
  duplicates: "Duplicate scan",
  subtitle_download: "Subtitle download",
  subtitle_sync: "Subtitle sync",
  model_download: "Model download",
  compress: "Compress",
  audio_scan: "Audio scan",
  audio_compress: "Audio compress",
  audio_toolbox: "Audio Toolbox",
  audio_duplicates: "Audio Duplicates",
  toolbox_fix: "Toolbox fix",
  splice_merge: "Splice",
  thumbnail_warm: "Generating thumbnails",
  // Stat-only kind: files removed by Cleanup, duplicates or image delete (no queue job).
  delete: "Cleanup",
};

/** Human label for a job type; falls back to the raw type string. */
export function jobLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

const ACTIVE = new Set(["running", "pending"]);
// Housekeeping that runs on its own after scans; a "finished" toast for it is noise.
const SILENT_TYPES = new Set(["thumbnail_warm"]);

/**
 * Jobs that went from running/pending (in `prev`) to completed in `jobs`. A job
 * not in `prev` at all (the first load, or one created and finished between
 * ticks) is ignored, so opening the app never replays old completions.
 */
export function newlyCompleted(prev: ReadonlyMap<number, string>, jobs: readonly Job[]): Job[] {
  return jobs.filter(
    (j) =>
      j.status === "completed" && !SILENT_TYPES.has(j.type) && ACTIVE.has(prev.get(j.id) ?? ""),
  );
}
