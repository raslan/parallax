import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTheme } from "@/components/ThemeProvider";
import { DangerZone } from "./DangerZone";

// ponytail: hex literals are intentional here — each swatch previews a theme
// that is NOT active, so it can't read that theme's `--px-accent` var. Keep in
// sync with the `--px-accent` values in index.css if a theme is retuned.
const THEMES = [
  { id: "amber" as const, label: "Mission Control", accent: "#f59e0b" },
  { id: "violet" as const, label: "Deep Space", accent: "#a78bfa" },
  { id: "cyan" as const, label: "Modern HUD", accent: "#22d3ee" },
  { id: "oled" as const, label: "OLED", accent: "#ffffff" },
  { id: "emerald" as const, label: "Neon Grid", accent: "#34d399" },
];

export function GeneralTab() {
  const { theme, setTheme } = useTheme();

  return (
    <>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">Colour theme</p>
            <p className="text-xs text-muted-foreground mb-4">Takes effect immediately.</p>
            <div className="flex gap-3">
              {THEMES.map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`w-32 flex flex-col items-center gap-2 p-3 rounded-[0.4rem] border transition-colors ${
                      isActive
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="h-8 w-8 rounded-full" style={{ background: t.accent }} />
                    <span className="text-xs font-medium text-center leading-tight">{t.label}</span>
                    {isActive && <Check className="h-3 w-3 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
      <DangerZone />
    </>
  );
}
