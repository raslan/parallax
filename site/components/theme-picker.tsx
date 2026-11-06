"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";
import { DEFAULT_THEME, THEMES, type ThemeId } from "@/lib/themes.generated";
import { applyTheme, THEME_EVENT, THEME_STORAGE_KEY } from "@/lib/theme-storage";

type Theme = (typeof THEMES)[number];

function readStored(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {
    // storage unavailable (private mode): fall through to the default
  }
  return DEFAULT_THEME as ThemeId;
}

/** A small preview of a theme: its page colour with an accent dot on top. */
function Swatch({ theme }: { theme: Theme }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-md border border-fd-border"
      style={{ background: theme.background }}
    >
      <span className="size-2.5 rounded-full" style={{ background: theme.accent }} />
    </span>
  );
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME as ThemeId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTheme(readStored());
    // Another control (for example the landing page's colour strip) can change the theme too.
    const onChange = (e: Event) => setTheme((e as CustomEvent<{ id: ThemeId }>).detail.id);
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  function choose(next: ThemeId) {
    setTheme(next);
    setOpen(false);
    applyTheme(next);
  }

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${current.label}, choose a theme`}
        className="flex w-full items-center gap-2.5 rounded-lg border border-fd-border bg-fd-secondary/50 px-3 py-2 text-sm text-fd-foreground transition-colors hover:bg-fd-accent"
      >
        <Swatch theme={current} />
        <span className="flex-1 truncate text-left">{current.label}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-fd-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-52 p-1.5"
      >
        <ul role="listbox" aria-label="Themes" className="flex flex-col gap-0.5">
          {THEMES.map((t) => (
            <li key={t.id} role="option" aria-selected={t.id === theme}>
              <button
                type="button"
                onClick={() => choose(t.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-fd-foreground transition-colors hover:bg-fd-accent"
              >
                <Swatch theme={t} />
                <span className="flex-1">{t.label}</span>
                {t.id === theme && <Check className="size-4 text-fd-primary" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
