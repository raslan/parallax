// The single source of truth for themes. Adding one = a new `<id>.css` file in this folder
// (a `[data-theme="<id>"]` block of shadcn variables) + one entry below. The CSS is static and
// ends up in the production stylesheet, so the server-stamped `data-theme` paints without a flash.
import "./base.css";

// Eagerly pulls every theme stylesheet into the bundle; nothing is read from the result.
import.meta.glob("./*.css", { eager: true });

export const THEME_GROUPS = ["Parallax", "Colour", "Classic palettes"] as const;
type ThemeGroup = (typeof THEME_GROUPS)[number];

interface ThemeEntry {
  id: string;
  label: string;
  group: ThemeGroup;
}

// Order is the picker/palette order.
export const THEME_META = [
  { id: "parallax", label: "Parallax", group: "Parallax" },
  { id: "graphite", label: "Graphite", group: "Parallax" },
  { id: "nightfall", label: "Nightfall", group: "Parallax" },
  { id: "rose", label: "Rose Quartz", group: "Parallax" },
  { id: "oled", label: "OLED", group: "Parallax" },
  { id: "violet", label: "Deep Space", group: "Colour" },
  { id: "cyan", label: "Modern HUD", group: "Colour" },
  { id: "emerald", label: "Neon Grid", group: "Colour" },
  { id: "catppuccin", label: "Catppuccin Mocha", group: "Classic palettes" },
  { id: "dracula", label: "Dracula", group: "Classic palettes" },
  { id: "nord", label: "Nord", group: "Classic palettes" },
  { id: "tokyo-night", label: "Tokyo Night", group: "Classic palettes" },
  { id: "gruvbox", label: "Gruvbox Dark", group: "Classic palettes" },
  { id: "solarized", label: "Solarized Dark", group: "Classic palettes" },
  { id: "one-dark", label: "One Dark", group: "Classic palettes" },
  { id: "rose-pine", label: "Rose Pine", group: "Classic palettes" },
] as const satisfies readonly ThemeEntry[];

export type ThemeMeta = (typeof THEME_META)[number];
export type Theme = ThemeMeta["id"];

export const DEFAULT_THEME: Theme = "parallax";

export const THEMES: Theme[] = THEME_META.map((t) => t.id);

export function isTheme(value: string | null | undefined): value is Theme {
  return !!value && (THEMES as string[]).includes(value);
}
