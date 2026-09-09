import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTheme } from "@/components/ThemeProvider";
import type { Theme } from "@/types/theme";
import { DangerZone } from "./DangerZone";

type ThemeOption = { id: Theme; label: string };

// Each preview card wraps its mock in `[data-theme=<id>]`, so the theme's
// tokens from index.css cascade scoped to that subtree — no per-theme colour
// list to keep in sync here.
const PARALLAX_THEMES: ThemeOption[] = [
  { id: "parallax", label: "Parallax" },
  { id: "graphite", label: "Graphite" },
  { id: "nightfall", label: "Nightfall" },
  { id: "rose", label: "Rose Quartz" },
  { id: "oled", label: "OLED" },
];

const COLOUR_THEMES: ThemeOption[] = [
  { id: "violet", label: "Deep Space" },
  { id: "cyan", label: "Modern HUD" },
  { id: "emerald", label: "Neon Grid" },
];

function ThemePreview({ option }: { option: ThemeOption }) {
  const { theme, setTheme } = useTheme();
  const isActive = theme === option.id;

  return (
    <button
      onClick={() => setTheme(option.id)}
      className={`group w-[168px] rounded-[0.4rem] border p-1 text-left transition-colors ${
        isActive ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/40"
      }`}
    >
      {/* Scoped theme sandbox — renders a mini app chrome in `option.id` */}
      <div
        data-theme={option.id}
        className="flex h-[96px] overflow-hidden rounded-[0.3rem]"
        style={{ background: "hsl(var(--background))" }}
      >
        <div className="w-3 shrink-0" style={{ background: "hsl(var(--sidebar))" }} />
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <div
            className="flex-1 rounded-[0.3rem] border p-1.5"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
          >
            <div
              className="mb-1.5 h-1.5 w-2/3 rounded-full"
              style={{ background: "hsl(var(--foreground))" }}
            />
            <div
              className="mb-1 h-1 w-full rounded-full"
              style={{ background: "hsl(var(--muted-foreground))" }}
            />
            <div
              className="h-1 w-4/5 rounded-full"
              style={{ background: "hsl(var(--muted-foreground))" }}
            />
          </div>
          <div className="flex gap-1">
            <div
              className="h-3 w-8 rounded-[0.25rem]"
              style={{ background: "hsl(var(--primary))" }}
            />
            <div
              className="h-3 w-5 rounded-[0.25rem]"
              style={{ background: "hsl(var(--secondary))" }}
            />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-1.5 pb-0.5 pt-1.5">
        <span className="text-xs font-medium">{option.label}</span>
        {isActive && <Check className="h-3 w-3 text-primary" />}
      </div>
    </button>
  );
}

function ThemeGroup({ title, options }: { title: string; options: ThemeOption[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-wrap gap-2.5">
        {options.map((o) => (
          <ThemePreview key={o.id} option={o} />
        ))}
      </div>
    </div>
  );
}

export function GeneralTab() {
  return (
    <>
      <Card>
        <CardContent className="space-y-6 pt-6">
          <div>
            <p className="text-sm font-medium">Colour theme</p>
            <p className="text-xs text-muted-foreground">Takes effect immediately.</p>
          </div>
          <ThemeGroup title="Parallax" options={PARALLAX_THEMES} />
          <ThemeGroup title="Colour" options={COLOUR_THEMES} />
        </CardContent>
      </Card>
      <DangerZone />
    </>
  );
}
