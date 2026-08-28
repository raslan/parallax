import { useCallback, useState } from "react";

/**
 * Bulk multi-select state (a Set of ids) shared by pages with a checkbox
 * grid/list — toggle one, select all from a given list, clear.
 */
export function useSelection<T = number>() {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const toggle = useCallback((id: T) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: T[]) => setSelected(new Set(ids)), []);
  const selectNone = useCallback(() => setSelected(new Set<T>()), []);

  return { selected, setSelected, toggle, selectAll, selectNone };
}
