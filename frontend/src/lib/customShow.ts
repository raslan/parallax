/**
 * Helpers for Identify's "Custom show" mode — turning a folder of YouTube
 * downloads (no TMDB entry) into a numbered one-season show.
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function stem(path: string): string {
  return basename(path).replace(/\.[^.]+$/, "");
}

// A trailing episode marker: "… Part 3", "… - Episode 12", "… Ep 4", "… E07",
// "… #5", or just a bare "… - 3" at the very end.
const TRAILING_MARKER = /\s*[-–|]?\s*\b(?:part|pt|episode|ep|e|#)\s*[.:#-]?\s*(\d{1,4})\s*$/i;
const BARE_TRAILING_NUM = /\s*[-–|]\s*(\d{1,4})\s*$/;
const LEADING_INDEX = /^\s*(\d{1,4})\s*[-–.)_]+\s*/;

/** The episode number a filename implies (leading index or trailing marker), or null. */
export function episodeIndexOf(path: string): number | null {
  const s = stem(path);
  const trailing = s.match(TRAILING_MARKER) ?? s.match(BARE_TRAILING_NUM);
  if (trailing) return parseInt(trailing[1]!, 10);
  const leading = s.match(LEADING_INDEX);
  if (leading) return parseInt(leading[1]!, 10);
  return null;
}

/**
 * Best guess at episode order. If most files carry an episode number (a leading
 * index or a trailing "Part N"/"Episode N"), sort by that — a trailing marker is
 * invisible to a plain filename sort. Otherwise fall back to a natural
 * (2 < 10) filename sort.
 */
export function orderFiles(paths: string[]): string[] {
  const indexed = paths.map((p) => [p, episodeIndexOf(p)] as const);
  const withNum = indexed.filter(([, n]) => n !== null).length;
  if (withNum >= Math.ceil(paths.length / 2) && withNum >= 2) {
    return [...indexed]
      .sort(([pa, a], [pb, b]) => {
        if (a !== null && b !== null && a !== b) return a - b;
        if (a !== null && b === null) return -1;
        if (a === null && b !== null) return 1;
        return collator.compare(basename(pa), basename(pb));
      })
      .map(([p]) => p);
  }
  return [...paths].sort((a, b) => collator.compare(basename(a), basename(b)));
}

const YT_ID_TRAILING = /[[(]?[A-Za-z0-9_-]{11}[\])]?$/;
const JUNK_TAG =
  /\b(2160p|1440p|1080p|720p|480p|4k|uhd|hdr|x264|x265|h\.?264|h\.?265|hevc|av1|web-?dl|web-?rip|bluray)\b/gi;

/**
 * Best-effort episode title from a download's filename. YouTube episode files
 * are commonly "EPISODE TITLE | Show Name - Part N.ext" or "NN - Title [id].ext"
 * — take the part before " | " when present, then drop a leading index, a
 * trailing episode marker, a trailing 11-char YouTube id, and quality tags.
 * Falls back to the bare stem if that leaves nothing.
 */
export function cleanEpisodeTitle(path: string): string {
  const raw = stem(path);
  let t = raw;
  const pipe = t.indexOf(" | ");
  if (pipe > 0) t = t.slice(0, pipe);
  t = t
    .replace(LEADING_INDEX, "")
    .replace(TRAILING_MARKER, "")
    .replace(BARE_TRAILING_NUM, "")
    .replace(/[_.]+/g, " ")
    .replace(JUNK_TAG, "")
    .replace(/[[(]\s*[\])]/g, "")
    .trim()
    .replace(/\s{2,}/g, " ");
  t = t.replace(YT_ID_TRAILING, "").trim();
  t = t.replace(/[-–|]\s*$/, "").trim();
  return t || raw;
}
