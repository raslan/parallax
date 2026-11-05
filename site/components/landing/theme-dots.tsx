"use client";

import { useEffect, useState } from "react";
import { DEFAULT_THEME, THEMES, type ThemeId } from "@/lib/themes.generated";
import { applyTheme, THEME_EVENT, THEME_STORAGE_KEY } from "@/lib/theme-storage";

/**
 * The colour strip: one swatch per theme. Picking one re-colours the whole page (and the header's picker follows).
 * Built on native radio inputs, so arrow keys, focus and screen readers behave the way people expect.
 */
export function ThemeDots() {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME as ThemeId);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved && THEMES.some((t) => t.id === saved)) setTheme(saved as ThemeId);
    } catch {
      // storage unavailable: the default stays
    }
    const onChange = (e: Event) => setTheme((e as CustomEvent<{ id: ThemeId }>).detail.id);
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  return (
    <fieldset className="lp-themes">
      <legend className="sr-only">Colour theme</legend>
      {THEMES.map((t) => (
        <label key={t.id} className="lp-theme">
          <input
            type="radio"
            name="lp-theme"
            value={t.id}
            checked={theme === t.id}
            onChange={() => {
              setTheme(t.id);
              applyTheme(t.id);
            }}
          />
          <span className="lp-theme-swatch" style={{ background: t.background }} aria-hidden="true">
            <span style={{ background: t.accent }} />
          </span>
          <span className="lp-theme-name">{t.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
