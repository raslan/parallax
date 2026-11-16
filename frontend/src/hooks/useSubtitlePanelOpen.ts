import { useState } from "react";

const KEY = "parallax-subtitle-panel";

/** `localStorage`, or null where the browser blocks even looking at it. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether the Manage panel is switched on, remembered per viewer in `localStorage` (a
 * convenience only: it works the same, un-remembered, where storage is blocked). While on,
 * the panel follows a single selected video.
 */
export function useSubtitlePanelOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return storage()?.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setOpen(next);
    try {
      storage()?.setItem(KEY, next ? "1" : "0");
    } catch {
      // The page works without remembering.
    }
  };
  return [open, set];
}
