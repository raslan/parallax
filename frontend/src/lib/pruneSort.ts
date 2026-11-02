import type { SortDir } from "@/components/FileSelectGrid";
import { naturalCompare } from "@/lib/naturalSort";
import type { FolderNodeInfo } from "@/types/prune";

export type FolderSortKey = "files" | "size" | "name";

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
