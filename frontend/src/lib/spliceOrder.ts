import type { VideoFile } from "@/types/file";

export type SortMode = "name" | "duration" | "date";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

export function sortOrder(
  ids: number[],
  byId: Map<number, VideoFile>,
  mode: SortMode,
  reverse: boolean,
): number[] {
  const get = (id: number) => byId.get(id);
  const sorted = [...ids].sort((a, b) => {
    const fa = get(a);
    const fb = get(b);
    if (!fa || !fb) return 0;
    if (mode === "name") return naturalCompare(fa.filename, fb.filename);
    if (mode === "duration") return (fa.duration ?? 0) - (fb.duration ?? 0);
    return (fa.file_date ?? 0) - (fb.file_date ?? 0);
  });
  return reverse ? sorted.reverse() : sorted;
}

export function syncOrder(
  prev: number[],
  selected: Set<number>,
  byId: Map<number, VideoFile>,
): number[] {
  const kept = prev.filter((id) => selected.has(id));
  const known = new Set(kept);
  const added = sortOrder(
    [...selected].filter((id) => !known.has(id)),
    byId,
    "name",
    false,
  );
  return [...kept, ...added];
}

export function defaultOutputName(files: VideoFile[]): string {
  const stems = files.map((f) => f.filename.replace(/\.[^.]+$/, ""));
  if (stems.length === 0) return "";
  let prefix = stems[0]!;
  for (const s of stems.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const cleaned = prefix
    .replace(/[\s\-_.–—([]+$/, "")
    .replace(/\s*\d+$/, "")
    .replace(/[\s\-_.–—([]+$/, "");
  return cleaned.length >= 3 ? cleaned : `${stems[0]} (merged)`;
}

export function moveItem(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
