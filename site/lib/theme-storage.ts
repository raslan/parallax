export const THEME_STORAGE_KEY = "parallax-site-theme";

/** Fired on `window` whenever the theme changes, so every control that shows the current theme stays in step. */
export const THEME_EVENT = "parallax-site-theme-change";

/** Switches the whole site to a theme, remembers the choice, and tells the other controls. */
export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // not persisted; still applies for this page view
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { id } }));
}
