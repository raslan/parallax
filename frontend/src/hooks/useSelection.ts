import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Inclusive slice of `order` between two ids, in either direction. Empty when
 * either id isn't in `order` (e.g. it was filtered out since the anchor was set).
 */
export function rangeBetween<T>(order: readonly T[], a: T, b: T): T[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i === -1 || j === -1) return [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

// Whether Shift was held on the most recent pointer press. Tracked once,
// globally, so a `toggle(id)` call site doesn't have to thread the click event
// through every card/row component.
let shiftOnLastPress = false;
if (typeof window !== "undefined") {
  // Keyboard presses update it too, so a Space-toggle after an old shift-click
  // isn't mistaken for another range select.
  for (const type of ["pointerdown", "keydown"] as const) {
    window.addEventListener(type, (e) => (shiftOnLastPress = e.shiftKey), true);
  }
}

/**
 * Bulk multi-select state (a Set of ids) shared by pages with a checkbox
 * grid/list — toggle one, select all from a given list, clear.
 *
 * Shift-click range select: register the visible, ordered ids with `setOrder`
 * (see `useSelectionOrder`); a `toggle` while Shift is held then selects
 * everything between the previous toggle and this one.
 */
export function useSelection<T = number>() {
  const [selected, setSelected] = useState<Set<T>>(new Set());
  const orderRef = useRef<readonly T[]>([]);
  const anchorRef = useRef<T | null>(null);

  const setOrder = useCallback((ids: readonly T[]) => {
    orderRef.current = ids;
  }, []);

  const toggle = useCallback((id: T) => {
    const anchor = anchorRef.current;
    const range =
      shiftOnLastPress && anchor !== null ? rangeBetween(orderRef.current, anchor, id) : [];
    anchorRef.current = id;
    setSelected((prev) => {
      const next = new Set(prev);
      if (range.length > 0) {
        for (const r of range) next.add(r);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: T[]) => setSelected(new Set(ids)), []);
  const selectNone = useCallback(() => {
    anchorRef.current = null;
    setSelected(new Set<T>());
  }, []);

  return { selected, setSelected, toggle, selectAll, selectNone, setOrder };
}

/** Keeps the selection's range-select order in step with what the page shows. */
export function useSelectionOrder<T>(setOrder: (ids: readonly T[]) => void, ids: readonly T[]) {
  useEffect(() => {
    setOrder(ids);
  }, [setOrder, ids]);
}
