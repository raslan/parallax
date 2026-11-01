import type { PruneFile } from "@/types/prune";

/** The visible paths that are not selected. Hidden rows never end up selected by an invert. */
export function invertSelection(
  visible: readonly string[],
  selected: ReadonlySet<string>,
): string[] {
  return visible.filter((p) => !selected.has(p));
}

/** The selection after a delete call: deleted paths leave it, failed ones stay selected. */
export function removeDeleted(
  selected: ReadonlySet<string>,
  deleted: readonly string[],
): Set<string> {
  const gone = new Set(deleted);
  return new Set([...selected].filter((p) => !gone.has(p)));
}

/** Files (in `files` order) that are selected: prunes the selection against a live list. */
export function selectedIn(
  files: readonly PruneFile[],
  selected: ReadonlySet<string>,
): PruneFile[] {
  return files.filter((f) => selected.has(f.path));
}

/**
 * The stored selection shrunk to `allowed` (the visible paths that are selected),
 * or null when nothing needs dropping. Returning null keeps render-time use cheap
 * and loop-free. Strict: a row hidden for any reason (including a details-backed
 * filter whose details have not loaded yet) is dropped, never kept aside.
 */
export function reconcileSelection(
  stored: ReadonlySet<string>,
  allowed: ReadonlySet<string>,
): Set<string> | null {
  return stored.size === allowed.size ? null : new Set(allowed);
}

/** Parent directory of a POSIX path (never empty). */
export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

/** Combined size of the selected files. */
export function sumBytes(files: readonly PruneFile[], selected: ReadonlySet<string>): number {
  let total = 0;
  for (const f of files) if (selected.has(f.path)) total += f.size;
  return total;
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
