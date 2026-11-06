"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, type ThemeId } from "@/lib/themes.generated";
import { THEME_EVENT } from "@/lib/theme-storage";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/**
 * The theme the page is showing right now. It reads `<html data-theme>`, which the inline script in the root
 * layout sets before first paint and `applyTheme` keeps current, so every control and picture agrees. The
 * server render (and the first client render) use the default theme.
 */
export function useTheme(): ThemeId {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme as ThemeId | undefined) ?? DEFAULT_THEME,
    () => DEFAULT_THEME as ThemeId,
  );
}
