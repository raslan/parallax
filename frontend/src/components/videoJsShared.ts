import type { CSSProperties } from "react";

// Themes the Video.js skins from the active theme's tokens (what --plyr-color-main used to do), so
// every theme's `--primary` drives the player accent.
export const MEDIA_THEME_STYLE = {
  "--media-accent-color": "hsl(var(--primary))",
  "--media-accent-text-color": "var(--px-on-accent)",
  "--media-border-radius": "var(--radius)",
  "--media-object-fit": "contain",
  colorScheme: "dark",
} as CSSProperties;

// Hotkeys (space, arrows, m, f, c, ...) only listen inside the player container, so focus it when
// the modal opens or the keys do nothing until the first click. The skin has no `ref` prop, so
// this is the ref of a wrapper div and focuses the skin root (its one tabbable element).
export function focusPlayer(wrapper: HTMLElement | null): void {
  wrapper?.querySelector<HTMLElement>("[tabindex='0']")?.focus({ preventScroll: true });
}
