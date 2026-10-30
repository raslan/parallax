/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { THEME_META } from "./registry";
import { contrastRatio } from "./importer";
import { readFileSync } from "node:fs";

const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");

// WCAG contrast guard over every theme stylesheet. New themes must pass every rule; the themes
// that predate the guard are listed in LEGACY_EXCEPTIONS (their pixels are deliberately
// unchanged), which documents the debt without hiding it.

const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("./*.css", { query: "?raw", import: "default", eager: true }),
  ).map(([path, css]) => [path.replace("./", "").replace(/\.css$/, ""), css]),
);

const TEXT = 4.5;
const BORDER = 1.3;
const RING = 3;
const UI_TEXT = 3.5;

interface Rule {
  name: string;
  min: number;
  /** [foreground, background] colour expressions. */
  pair: (t: ThemeVars) => [string, string];
}

interface ThemeVars {
  /** Value of `--<name>` as an `hsl(...)` colour. */
  hsl: (name: string) => string;
  /** Effective `--px-accent`: the theme's override, else the `hsl(var(--primary))` base.css derives. */
  accent: string;
  /** Effective `--px-on-accent`: the theme's override, else the global one. */
  onAccent: string;
  /** Effective `--destructive` / `--destructive-foreground`: the theme's override, else the global `:root` one. */
  destructive: string;
  destructiveFg: string;
}

function readVars(css: string): ThemeVars {
  const triplet = (name: string): string => {
    const m = new RegExp(`--${name}:\\s*(\\d{1,3} \\d{1,3}% \\d{1,3}%);`).exec(css);
    if (!m) throw new Error(`--${name} missing`);
    return m[1] ?? "";
  };
  const override = (name: string): string | undefined =>
    new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
  const hsl = (name: string) => `hsl(${triplet(name)})`;
  const globalOnAccent = /--px-on-accent:\s*([^;]+);/.exec(indexCss)?.[1]?.trim();
  if (!globalOnAccent) throw new Error("global --px-on-accent missing from index.css");
  const globalTriplet = (name: string): string => {
    const m = new RegExp(`--${name}:\\s*(\\d{1,3} \\d{1,3}% \\d{1,3}%);`).exec(indexCss);
    if (!m) throw new Error(`global --${name} missing from index.css`);
    return `hsl(${m[1] ?? ""})`;
  };
  const effective = (name: string): string => {
    const own = override(name);
    return own ? `hsl(${own})` : globalTriplet(name);
  };
  return {
    hsl,
    destructive: effective("destructive"),
    destructiveFg: effective("destructive-foreground"),
    accent: override("px-accent") ?? hsl("primary"),
    onAccent: override("px-on-accent") ?? globalOnAccent,
  };
}

const RULES: Rule[] = [
  {
    name: "foreground/background",
    min: TEXT,
    pair: (t) => [t.hsl("foreground"), t.hsl("background")],
  },
  {
    name: "card-foreground/card",
    min: TEXT,
    pair: (t) => [t.hsl("card-foreground"), t.hsl("card")],
  },
  {
    name: "popover-foreground/popover",
    min: TEXT,
    pair: (t) => [t.hsl("popover-foreground"), t.hsl("popover")],
  },
  {
    name: "secondary-foreground/secondary",
    min: TEXT,
    pair: (t) => [t.hsl("secondary-foreground"), t.hsl("secondary")],
  },
  {
    name: "accent-foreground/accent",
    min: TEXT,
    pair: (t) => [t.hsl("accent-foreground"), t.hsl("accent")],
  },
  {
    name: "muted-foreground/background",
    min: TEXT,
    pair: (t) => [t.hsl("muted-foreground"), t.hsl("background")],
  },
  {
    name: "muted-foreground/card",
    min: TEXT,
    pair: (t) => [t.hsl("muted-foreground"), t.hsl("card")],
  },
  {
    name: "primary-foreground/primary",
    min: TEXT,
    pair: (t) => [t.hsl("primary-foreground"), t.hsl("primary")],
  },
  { name: "border/background", min: BORDER, pair: (t) => [t.hsl("border"), t.hsl("background")] },
  { name: "ring/background", min: RING, pair: (t) => [t.hsl("ring"), t.hsl("background")] },
  { name: "px-on-accent/px-accent", min: TEXT, pair: (t) => [t.onAccent, t.accent] },
  // Destructive is used for error text, badges and borders (large-ish UI): 3.5, not full text.
  {
    name: "destructive/background",
    min: UI_TEXT,
    pair: (t) => [t.destructive, t.hsl("background")],
  },
  { name: "destructive/card", min: UI_TEXT, pair: (t) => [t.destructive, t.hsl("card")] },
  { name: "destructive/popover", min: UI_TEXT, pair: (t) => [t.destructive, t.hsl("popover")] },
  {
    name: "destructive-foreground/destructive",
    min: TEXT,
    pair: (t) => [t.destructiveFg, t.destructive],
  },
];

interface LegacyException {
  theme: string;
  rule: string;
  /** Measured ratio (2 dp). The test fails if the pair gets worse than this. */
  ratio: number;
  note: string;
}

// Debt from before the guard existed. Each entry must stay failing (else delete it) and must not
// get worse. Do not restyle a theme just to clear one; delete the entry when its pair is fixed.
const LEGACY_EXCEPTIONS: LegacyException[] = [
  {
    theme: "violet",
    rule: "primary-foreground/primary",
    ratio: 2.59,
    note: "white-ish primary-foreground on the bright violet primary; buttons use --px-on-accent (passes) instead",
  },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const LEGACY_THEMES = new Set(LEGACY_EXCEPTIONS.map((e) => e.theme));

describe("theme contrast", () => {
  for (const { id } of THEME_META) {
    const vars = readVars(sources[id] ?? "");
    describe(id, () => {
      for (const rule of RULES) {
        const exception = LEGACY_EXCEPTIONS.find((e) => e.theme === id && e.rule === rule.name);
        it(`${rule.name} >= ${rule.min}`, () => {
          const [fg, bg] = rule.pair(vars);
          const ratio = round2(contrastRatio(fg, bg));
          if (!exception) {
            expect(ratio, `${id} ${rule.name} is ${ratio}`).toBeGreaterThanOrEqual(rule.min);
            return;
          }
          expect(ratio, `${id} ${rule.name} now passes: delete its LEGACY_EXCEPTION`).toBeLessThan(
            rule.min,
          );
          expect(
            ratio,
            `${id} ${rule.name} got worse than ${exception.ratio}`,
          ).toBeGreaterThanOrEqual(exception.ratio);
        });
      }
    });
  }

  it("only lists exceptions for real themes and rules", () => {
    const ids = new Set(THEME_META.map((t) => t.id));
    const names = new Set(RULES.map((r) => r.name));
    for (const e of LEGACY_EXCEPTIONS) {
      expect(ids.has(e.theme as never), e.theme).toBe(true);
      expect(names.has(e.rule), e.rule).toBe(true);
    }
    expect(LEGACY_THEMES.size).toBeLessThanOrEqual(8);
  });
});
