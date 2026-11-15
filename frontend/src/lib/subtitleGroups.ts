import { naturalCompare } from "@/lib/naturalSort";
import type { SortDir } from "@/components/FileSelectGrid";
import type { ScanFile, TitleGroup } from "@/types/subtitle";

export type TitleFileSort = "episode" | "name";

export const TITLE_FILE_SORTS: readonly { value: TitleFileSort; label: string }[] = [
  { value: "episode", label: "Episode" },
  { value: "name", label: "Name" },
];

/**
 * A title's files in episode order (season, then episode, files without either last,
 * ties by name) or by name, natural order either way; never mutates.
 */
export function sortTitleFiles(files: ScanFile[], key: TitleFileSort, dir: SortDir): ScanFile[] {
  const big = Number.MAX_SAFE_INTEGER;
  const byName = (a: ScanFile, b: ScanFile) => naturalCompare(a.filename, b.filename);
  const cmp =
    key === "name"
      ? byName
      : (a: ScanFile, b: ScanFile) =>
          (a.season ?? big) - (b.season ?? big) ||
          (a.episode ?? big) - (b.episode ?? big) ||
          byName(a, b);
  const out = [...files].sort(cmp);
  return dir === "desc" ? out.reverse() : out;
}

/** One title of the folder (a show or a film) with its scanned videos, in the group's order. */
export interface TitleWithFiles {
  group: TitleGroup;
  files: ScanFile[];
}

/**
 * Pairs the server's title groups with the scan's files. Groups keep the server's order
 * (by title) and each group its own file order; a path the scan no longer has (a file
 * deleted between the two reads) is dropped, and a group left empty with it.
 */
export function groupFiles(files: ScanFile[], groups: TitleGroup[]): TitleWithFiles[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const out: TitleWithFiles[] = [];
  for (const group of groups) {
    const own = group.files.flatMap((p) => {
      const f = byPath.get(p);
      return f ? [f] : [];
    });
    if (own.length > 0) out.push({ group, files: own });
  }
  return out;
}

/** The pill on a title card: a suggestion about the title, never a gate. */
export function titleStatus(group: TitleGroup, skipped: boolean): string | null {
  if (skipped) return "Skipped";
  if (group.needs_choice) return "Pick which one";
  if (group.layout_clean) return "Layout looks right";
  return null;
}

/** Distinct seasons among a title's files (files without a season are not counted). */
export function seasonCount(files: ScanFile[]): number {
  return new Set(files.flatMap((f) => (f.season == null ? [] : [f.season]))).size;
}
