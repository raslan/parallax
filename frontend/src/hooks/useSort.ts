import { useCallback, useState } from "react";
import type { SortDir } from "@/components/FileSelectGrid";

const ascending = (): SortDir => "asc";

/**
 * Sort key/direction state shared by pages with a sortable file grid/list —
 * clicking the active column flips direction, clicking a new one resets to that
 * key's default direction (ascending unless `defaultDir` says otherwise, e.g.
 * size/count columns that read best largest-first). Callers still own the actual
 * comparator (it varies per page), this just dedupes the key/dir state and the
 * click-toggle behavior. Pass a module-level `defaultDir` (stable identity).
 */
export function useSort<K extends string>(
  defaultKey: K,
  defaultDir: (key: K) => SortDir = ascending,
) {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(() => defaultDir(defaultKey));

  const toggleSort = useCallback(
    (key: K) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(defaultDir(key));
      }
    },
    [sortKey, defaultDir],
  );

  return { sortKey, setSortKey, sortDir, setSortDir, toggleSort };
}
