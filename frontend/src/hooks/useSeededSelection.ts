import { useCallback, useMemo, useState } from "react";

/** The suggested deletions for a set of duplicate groups: every copy except the keeper. */
export function seedFromGroups(
  groups: readonly { files: readonly { id: number }[]; keep_id: number }[],
): { seed: Set<number>; visible: Set<number> } {
  const seed = new Set<number>();
  const visible = new Set<number>();
  for (const g of groups) {
    for (const f of g.files) {
      visible.add(f.id);
      if (f.id !== g.keep_id) seed.add(f.id);
    }
  }
  return { seed, visible };
}

/**
 * What is ticked: for every copy on screen, the user's own choice if they made
 * one, else the suggestion. Copies that are not on screen are never ticked.
 */
export function applyOverrides(
  seed: ReadonlySet<number>,
  visible: ReadonlySet<number>,
  overrides: ReadonlyMap<number, boolean>,
): Set<number> {
  const selected = new Set<number>();
  for (const id of visible) {
    if (overrides.get(id) ?? seed.has(id)) selected.add(id);
  }
  return selected;
}

/**
 * The delete selection for a duplicates page. It is derived, not stored: the
 * suggested deletions (`seed`) with the user's own ticks and unticks laid over
 * the top. Each hand-made choice is remembered per file, so it survives groups
 * recomputing, a copy leaving and rejoining a group, and the keeper changing.
 * Memoise both arguments.
 */
export function useSeededSelection(seed: ReadonlySet<number>, visible: ReadonlySet<number>) {
  const [overrides, setOverrides] = useState<ReadonlyMap<number, boolean>>(new Map());

  const selected = useMemo(
    () => applyOverrides(seed, visible, overrides),
    [seed, visible, overrides],
  );

  const toggle = useCallback(
    (id: number) => setOverrides((prev) => new Map(prev).set(id, !(prev.get(id) ?? seed.has(id)))),
    [seed],
  );

  /** Untick everything on screen (the user's choice, so it sticks). */
  const clear = useCallback(
    () =>
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const id of visible) next.set(id, false);
        return next;
      }),
    [visible],
  );

  /** Forget every hand-made choice (e.g. when another library is picked). */
  const reset = useCallback(() => setOverrides(new Map()), []);

  return { selected, toggle, clear, reset };
}
