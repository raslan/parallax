import { createContext, useContext, useEffect, useState } from "react";
import { settingsApi } from "@/lib/api/settings";
import { THEMES, type Theme } from "@/types/theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "parallax",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function isTheme(value: string | null | undefined): value is Theme {
  return !!value && (THEMES as string[]).includes(value);
}

// The server stamps the saved theme on <html data-theme> before first paint, so it wins; the
// browser's own copy only covers the dev server (no stamping) and an unreachable backend.
function getInitialTheme(): Theme {
  const stamped = document.documentElement.getAttribute("data-theme");
  if (isTheme(stamped)) return stamped;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("parallax-theme");
  } catch {
    // storage blocked: fall through to the default
  }
  return isTheme(stored) ? stored : "parallax";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("parallax-theme", theme);
    } catch {
      // storage blocked: the saved server copy still applies
    }
  }, [theme]);

  function setTheme(t: Theme) {
    if (t === theme) return;
    setThemeState(t);
    // Saved server-side so any browser (incognito, another device) opens with it.
    // A failed save only costs persistence; the theme already switched locally.
    settingsApi.updateSettings({ theme: t }).catch(() => {});
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
