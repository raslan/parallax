import { createContext, useContext, useEffect, useState } from "react";

type Theme = "violet" | "cyan" | "amber" | "oled" | "rose" | "emerald" | "indigo";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "violet",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getStoredTheme(): Theme {
  const stored = localStorage.getItem("parallax-theme");
  const valid = ["violet", "cyan", "amber", "oled", "rose", "emerald", "indigo"];
  const theme: Theme = (stored && valid.includes(stored)) ? stored as Theme : "violet";
  document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("parallax-theme", theme);
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
