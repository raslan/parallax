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

/** Path segments of `path` relative to `root`, e.g. "/root/Playlist 1/a.mp4"
 * under root "/root" → ["Playlist 1", "a.mp4"]. */
function relSegments(path: string, root: string): string[] {
  const r = root.endsWith("/") ? root.slice(0, -1) : root;
  const rel = path.startsWith(r + "/") ? path.slice(r.length + 1) : path;
  return rel.split("/");
}

/** True if any file lives inside a subfolder of the source root — the signal
 * that offers "Folders are seasons" in Custom mode. */
export function hasSeasonFolders(paths: string[], rootPath: string): boolean {
  return paths.some((p) => relSegments(p, rootPath).length > 1);
}

export interface SeasonGroup {
  seasonNumber: number;
  /** null for files that sit directly under the source root (no season folder). */
  folderName: string | null;
  paths: string[];
}

/**
 * Groups files by their immediate parent folder under the source root, for
 * Custom mode's "Folders are seasons" toggle. Within-group order is preserved
 * from the input (the caller applies sort/reverse to the flat order first).
 * Season numbers: any loose root files become a leading season 1 (so nothing
 * is silently dropped), then real subfolders follow, natural-sorted by name —
 * Plex/Jellyfin only see the season number we write, not the source folder
 * name, so this is just an initial numbering guess, not a compat requirement.
 */
export function groupBySeasonFolder(paths: string[], rootPath: string): SeasonGroup[] {
  const loose: string[] = [];
  const byFolder = new Map<string, string[]>();
  for (const p of paths) {
    const segments = relSegments(p, rootPath);
    if (segments.length <= 1) {
      loose.push(p);
    } else {
      const folder = segments[0]!;
      (byFolder.get(folder) ?? byFolder.set(folder, []).get(folder)!).push(p);
    }
  }
  const folderNames = [...byFolder.keys()].sort((a, b) => collator.compare(a, b));
  const groups: SeasonGroup[] = [];
  let n = 1;
  if (loose.length > 0) groups.push({ seasonNumber: n++, folderName: null, paths: loose });
  for (const name of folderNames) {
    groups.push({ seasonNumber: n++, folderName: name, paths: byFolder.get(name)! });
  }
  return groups;
}

/**
 * Moves `fromPath` to `toIndex` within its own group (a season, under the
 * folders-are-seasons toggle, or the whole order otherwise), leaving every
 * other group's relative order untouched. Used by the per-row episode-number
 * input, which should only shift files within the same season.
 */
export function reorderWithinGroup(
  order: string[],
  groupPaths: string[],
  fromPath: string,
  toIndex: number,
): string[] {
  const from = groupPaths.indexOf(fromPath);
  if (from < 0) return order;
  const nextGroup = [...groupPaths];
  const clamped = Math.max(0, Math.min(nextGroup.length - 1, toIndex));
  nextGroup.splice(clamped, 0, nextGroup.splice(from, 1)[0]!);

  const inGroup = new Set(groupPaths);
  let i = 0;
  return order.map((p) => (inGroup.has(p) ? nextGroup[i++]! : p));
}
