import { useCallback, useState } from "react";
import type { SortDir } from "@/components/FileSelectGrid";

/**
 * Sort key/direction state shared by pages with a sortable file grid/list —
 * clicking the active column flips direction, clicking a new one resets to
 * ascending. Callers still own the actual comparator (it varies per page),
 * this just dedupes the key/dir state and the click-toggle behavior.
 */
export function useSort<K extends string>(defaultKey: K) {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = useCallback((key: K) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortDir("asc");
      }
      return key;
    });
  }, []);

  return { sortKey, setSortKey, sortDir, setSortDir, toggleSort };
}
