import { useState } from "react";
import { loadTagColumns, saveTagColumns, type TagColumnId } from "@/lib/organizeTags";

/** `localStorage`, or null where the browser blocks even looking at it. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The tag columns Organize's list shows, remembered per viewer in `localStorage`
 * (a convenience only: it works the same, un-remembered, where storage is blocked).
 */
export function useTagColumns(): [TagColumnId[], (cols: TagColumnId[]) => void] {
  const [columns, setColumns] = useState<TagColumnId[]>(() => {
    const s = storage();
    return s ? loadTagColumns(s) : loadTagColumns({ getItem: () => null });
  });
  const set = (cols: TagColumnId[]) => {
    setColumns(cols);
    const s = storage();
    if (s) saveTagColumns(s, cols);
  };
  return [columns, set];
}
