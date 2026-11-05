import type { SortDir } from "@/components/FileSelectGrid";
import { naturalCompare } from "@/lib/naturalSort";
import type { FileDetails, FolderNodeInfo, OrganizeFile } from "@/types/organize";

export type FolderSortKey = "files" | "size" | "name";

export type FileSortKey =
  "name" | "size" | "added" | "kind" | "duration" | "resolution" | "codec" | "bitrate";

/** Options of the sort pickers in `BrowseControls`. */
export const FOLDER_SORT_OPTIONS: { value: FolderSortKey; label: string }[] = [
  { value: "files", label: "Files" },
  { value: "size", label: "Size" },
  { value: "name", label: "Name" },
];

export const FILE_SORT_OPTIONS: { value: FileSortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
  { value: "added", label: "File added" },
  { value: "kind", label: "Type" },
  { value: "duration", label: "Duration" },
  { value: "resolution", label: "Resolution" },
  { value: "codec", label: "Codec" },
  { value: "bitrate", label: "Bitrate" },
];

/** Names read A→Z first; counts and sizes largest first (`useSort`'s `defaultDir`). */
export const folderSortDefaultDir = (key: FolderSortKey): SortDir =>
  key === "name" ? "asc" : "desc";

/** Text-like keys ascending; measures (size, dates, duration, …) largest/newest first. */
export const fileSortDefaultDir = (key: FileSortKey): SortDir =>
  key === "name" || key === "kind" || key === "codec" ? "asc" : "desc";

/**
 * Sorts a copy of `folders`. Names use the locale-aware natural compare (so
 * "Season 2" < "Season 10" and Hangul/Latin mix without throwing). Ties keep
 * their input order in both directions (Array.sort is stable; the direction is
 * applied to the comparator, never by reversing the result).
 */
export function sortFolders(
  folders: FolderNodeInfo[],
  key: FolderSortKey,
  dir: SortDir,
): FolderNodeInfo[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: FolderNodeInfo, b: FolderNodeInfo) => {
    if (key === "files") return a.total.files - b.total.files;
    if (key === "size") return a.total.bytes - b.total.bytes;
    return naturalCompare(a.name, b.name);
  };
  return [...folders].sort((a, b) => sign * cmp(a, b));
}

const KIND_ORDER: Record<OrganizeFile["kind"], number> = { video: 0, image: 1, audio: 2, other: 3 };

/** The value a details-backed key sorts on, or null when the file has none (yet). */
function detailValue(d: FileDetails | null | undefined, key: FileSortKey): number | string | null {
  if (!d) return null;
  switch (key) {
    case "duration":
      return d.duration;
    case "resolution":
      return d.width != null && d.height != null ? d.width * d.height : null;
    case "codec":
      return d.codec;
    case "bitrate":
      return d.bitrate;
    default:
      return null;
  }
}

const DETAIL_KEYS = new Set<FileSortKey>(["duration", "resolution", "codec", "bitrate"]);

/**
 * Sorts a copy of `files` by `key`. Name/codec use the natural compare,
 * resolution the pixel count. For the details-backed keys (duration, resolution,
 * codec, bitrate) files without that value — details not loaded, failed, or the
 * field is null — go last in input order, whatever the direction. Ties keep their
 * input order in both directions.
 */
export function sortFiles(
  files: OrganizeFile[],
  details: Record<string, FileDetails | null>,
  key: FileSortKey,
  dir: SortDir,
): OrganizeFile[] {
  const sign = dir === "asc" ? 1 : -1;
  if (DETAIL_KEYS.has(key)) {
    const known: { f: OrganizeFile; v: number | string }[] = [];
    const missing: OrganizeFile[] = [];
    for (const f of files) {
      const v = detailValue(details[f.path], key);
      if (v == null) missing.push(f);
      else known.push({ f, v });
    }
    known.sort((a, b) => {
      const c =
        typeof a.v === "string" || typeof b.v === "string"
          ? naturalCompare(String(a.v), String(b.v))
          : a.v - b.v;
      return sign * c;
    });
    return [...known.map((k) => k.f), ...missing];
  }
  const cmp = (a: OrganizeFile, b: OrganizeFile) => {
    switch (key) {
      case "size":
        return a.size - b.size;
      case "added":
        return a.mtime - b.mtime;
      case "kind":
        return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      default:
        return naturalCompare(a.name, b.name);
    }
  };
  return [...files].sort((a, b) => sign * cmp(a, b));
}
