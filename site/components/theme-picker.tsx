"use client";

import { useEffect, useState } from "react";
import { Palette } from "lucide-react";
import { DEFAULT_THEME, THEMES, type ThemeId } from "@/lib/themes.generated";
import { THEME_STORAGE_KEY } from "@/lib/theme-storage";

function readStored(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {
    // storage unavailable (private mode): fall through to the default
  }
  return DEFAULT_THEME as ThemeId;
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME as ThemeId);

  useEffect(() => {
    setTheme(readStored());
  }, []);

  function choose(next: ThemeId) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // not persisted; still applies for this page view
    }
  }

  return (
    <label className="flex items-center gap-2 text-sm text-fd-muted-foreground">
      <Palette className="size-4" aria-hidden />
      <span className="sr-only">Theme</span>
      <select
        value={theme}
        onChange={(e) => choose(e.target.value as ThemeId)}
        className="rounded-md border border-fd-border bg-fd-card px-2 py-1 text-fd-foreground"
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
