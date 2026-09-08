/**
 * Helpers for Identify's "Custom show" mode — turning a folder of YouTube
 * downloads (no TMDB entry) into a numbered one-season show.
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Natural (2 < 10) sort of file paths by their filename. */
export function naturalSort(paths: string[]): string[] {
  return [...paths].sort((a, b) => collator.compare(basename(a), basename(b)));
}

const YT_ID_TRAILING = /[[(]?[A-Za-z0-9_-]{11}[\])]?$/;
const LEADING_INDEX = /^\s*\d{1,4}\s*[-–.)_]+\s*/;
const JUNK_TAG =
  /\b(2160p|1440p|1080p|720p|480p|4k|uhd|hdr|x264|x265|h\.?264|h\.?265|hevc|av1|web-?dl|web-?rip|bluray)\b/gi;

/**
 * Best-effort episode title from a download's filename: drop the extension, a
 * leading playlist index ("03 - "), a trailing 11-char YouTube id, and common
 * quality/codec tags; tidy separators. Falls back to the bare stem if that
 * leaves nothing.
 */
export function cleanEpisodeTitle(path: string): string {
  const stem = basename(path).replace(/\.[^.]+$/, "");
  let t = stem
    .replace(LEADING_INDEX, "")
    .replace(/[_.]+/g, " ")
    .replace(JUNK_TAG, "")
    .replace(/[[(]\s*[\])]/g, "")
    .trim()
    .replace(/\s{2,}/g, " ");
  // Trailing YouTube id, with or without surrounding brackets.
  t = t.replace(YT_ID_TRAILING, "").trim();
  t = t.replace(/[-–|]\s*$/, "").trim();
  return t || stem;
}
