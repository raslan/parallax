import { useState } from "react";

const STORAGE_KEY = "parallax-grid-size";

/**
 * Persists a virtualized grid's card size (column min-width, px) globally,
 * shared across every page that uses it — set it once anywhere, it applies
 * everywhere. Falls back to `defaultWidth` when nothing is stored yet or
 * storage is unavailable.
 */
export function useGridSize(defaultWidth: number) {
  const [width, setWidthState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? Number(stored) : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });

  function setWidth(next: number) {
    setWidthState(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
  }

  return [width, setWidth] as const;
}
