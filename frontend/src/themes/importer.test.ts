import { describe, expect, it } from "vitest";
import {
  REQUIRED_VARS,
  ThemeImportError,
  buildTheme,
  compositeOver,
  contrastRatio,
  extractDarkVars,
  importTheme,
  parseColor,
  renderThemeCss,
  toTriplet,
} from "./importer";

const bytes = (c: { r: number; g: number; b: number }) =>
  [c.r, c.g, c.b].map((x) => Math.round(x * 255));
const trip = (v: string) => toTriplet(parseColor(v));

describe("colour conversion", () => {
  it("maps OKLCH white, black and mid grey", () => {
    expect(trip("oklch(1 0 0)")).toBe("0 0% 100%");
    expect(trip("oklch(0 0 0)")).toBe("0 0% 0%");
    expect(bytes(parseColor("oklch(0.5 0 0)"))).toEqual([99, 99, 99]);
    expect(trip("oklch(0.5 0 0)")).toBe("0 0% 39%");
  });

  // Reference: independent python implementation going OKLab -> LMS -> XYZ (D65) -> linear sRGB with
  // the CSS Color 4 spec matrices (not the Ottosson direct LMS->RGB matrix the importer uses).
  it("matches an independent XYZ-route reference for saturated colours", () => {
    expect(bytes(parseColor("oklch(0.7 0.15 150)"))).toEqual([76, 184, 106]);
    expect(bytes(parseColor("oklch(0.5 0.2 260)"))).toEqual([5, 89, 210]);
    expect(bytes(parseColor("oklch(0.269 0.01 286)"))).toEqual([38, 38, 43]);
    expect(trip("oklch(0.7 0.15 150)")).toBe("137 43% 51%");
  });

  it("accepts percentages, none and hue units in oklch", () => {
    expect(trip("oklch(70% 0.15 150deg)")).toBe(trip("oklch(0.7 0.15 150)"));
    expect(trip("oklch(0.7 37.5% 150)")).toBe(trip("oklch(0.7 0.15 150)"));
    expect(trip("oklch(0.7 0.15 0.416667turn)")).toBe(trip("oklch(0.7 0.15 150)"));
    expect(trip("oklch(0.5 none none)")).toBe("0 0% 39%");
  });

  it("flags out-of-gamut colours and clamps them", () => {
    const p = parseColor("oklch(0.6 0.25 30)");
    expect(p.clipped).toBe(true);
    expect([p.r, p.g, p.b].every((c) => c >= 0 && c <= 1)).toBe(true);
    expect(parseColor("oklch(0.7 0.15 150)").clipped).toBe(false);
    expect(parseColor("oklch(1 0 0)").clipped).toBe(false);
  });

  it("parses hex, rgb, hsl, triplets and keywords", () => {
    expect(trip("#e6b450")).toBe("40 75% 61%");
    expect(trip("#fff")).toBe("0 0% 100%");
    expect(parseColor("#ffffff80").a).toBeCloseTo(0.5, 2);
    expect(trip("rgb(255 0 0)")).toBe("0 100% 50%");
    expect(trip("rgb(255, 0, 0)")).toBe("0 100% 50%");
    expect(trip("rgb(100% 0% 0%)")).toBe("0 100% 50%");
    expect(trip("rgba(255, 0, 0, 0.5)")).toBe("0 100% 50%");
    expect(parseColor("rgba(255, 0, 0, 0.5)").a).toBe(0.5);
    expect(trip("white")).toBe("0 0% 100%");
    expect(trip("black")).toBe("0 0% 0%");
    expect(parseColor("transparent").a).toBe(0);
  });

  it("round-trips HSL in every syntax", () => {
    for (const v of [
      "220 28% 6%",
      "hsl(220 28% 6%)",
      "hsl(220, 28%, 6%)",
      "hsla(220, 28%, 6%, 1)",
      "hsl(220deg 28% 6% / 100%)",
    ]) {
      expect(trip(v), v).toBe("220 28% 6%");
    }
    expect(trip("40 74% 61%")).toBe("40 74% 61%");
    expect(parseColor("hsl(220 28% 6% / 0.4)").a).toBe(0.4);
    expect(parseColor("hsla(220, 28%, 6%, 0.4)").a).toBe(0.4);
  });

  it("composites translucent colours over a solid background", () => {
    const bg = parseColor("0 0% 10%");
    const border = compositeOver(parseColor("oklch(1 0 0 / 10%)"), bg);
    expect(border.a).toBe(1);
    expect(toTriplet(border)).toBe("0 0% 19%");
    const input = compositeOver(parseColor("oklch(1 0 0 / 15%)"), bg);
    expect(toTriplet(input)).toBe("0 0% 24%");
  });

  it("rejects unsupported syntax with the variable name", () => {
    for (const v of ["var(--x)", "calc(1 + 2)", "color-mix(in srgb, red, blue)", "lab(50 1 1)"]) {
      expect(() => parseColor(v, "border"), v).toThrow(ThemeImportError);
      expect(() => parseColor(v, "border"), v).toThrow(/--border/);
    }
    expect(() => parseColor("oklch(from red l c h)", "ring")).toThrow(/--ring/);
    expect(() => parseColor("rebeccapurple", "ring")).toThrow(/--ring/);
    expect(() => parseColor("#12", "ring")).toThrow(/--ring/);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for equal colours", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
    expect(contrastRatio("0 0% 50%", "0 0% 50%")).toBeCloseTo(1, 5);
  });
});

const DARK_CSS = `
/* a tweakcn export */
:root {
  --background: oklch(1 0 0);
  --primary: oklch(0.9 0.1 90);
}
@theme inline {
  --color-background: var(--background);
  --font-sans: Inter, sans-serif;
}
.dark {
  --background: oklch(0.2 0 0); /* dark bg */
  --foreground: oklch(0.95 0 0);
  --primary: oklch(0.7 0.15 150);
  --font-sans: Inter;
  --radius: 0.5rem;
  --shadow-sm: 0 1px 2px #0003;
  --destructive: oklch(0.6 0.2 25);
  --chart-1: oklch(0.6 0.2 25);
}
`;

describe("extractDarkVars", () => {
  it("takes the .dark block, ignoring comments, :root and @theme inline", () => {
    const vars = extractDarkVars(DARK_CSS);
    expect(vars["background"]).toBe("oklch(0.2 0 0)");
    expect(vars["primary"]).toBe("oklch(0.7 0.15 150)");
    expect(vars["color-background"]).toBeUndefined();
  });

  it("tolerates grouped dark selectors", () => {
    const vars = extractDarkVars(`.dark, [data-theme="dark"] { --background: #000; }`);
    expect(vars["background"]).toBe("#000");
  });

  it("fails clearly when there is no .dark block", () => {
    expect(() => extractDarkVars(`:root { --background: #fff; }`)).toThrow(/\.dark/);
    expect(() => extractDarkVars("")).toThrow(/empty/);
  });

  it("reads cssVars.dark from a registry-item JSON", () => {
    const json = JSON.stringify({
      name: "x",
      cssVars: {
        theme: { "font-sans": "Inter" },
        light: { background: "0 0% 100%" },
        dark: { background: "220 28% 6%", "--foreground": "oklch(0.95 0 0)" },
      },
    });
    expect(extractDarkVars(json)).toEqual({
      background: "220 28% 6%",
      foreground: "oklch(0.95 0 0)",
    });
    expect(() => extractDarkVars(`{"cssVars":{"light":{}}}`)).toThrow(/cssVars\.dark/);
  });
});

describe("buildTheme", () => {
  const base = {
    background: "oklch(0.2 0 0)",
    foreground: "oklch(0.95 0 0)",
    primary: "oklch(0.7 0.15 150)",
  };

  it("defines every required variable, deriving missing ones", () => {
    const t = buildTheme(base);
    expect(Object.keys(t.vars).sort()).toEqual([...REQUIRED_VARS].sort());
    expect(t.converted.sort()).toEqual(["background", "foreground", "primary"]);
    expect(t.derived.map((d) => d.name)).toContain("sidebar-border");
    expect(t.vars["card"]).toBe(t.vars["background"]);
    expect(t.vars["ring"]).toBe(t.vars["primary"]);
    expect(t.vars["sidebar-foreground"]).toBe(t.vars["foreground"]);
  });

  it("flattens alpha over the background and warns about it", () => {
    const t = buildTheme({ ...base, background: "0 0% 10%", border: "oklch(1 0 0 / 10%)" });
    expect(t.vars["border"]).toBe("0 0% 19%");
    expect(t.warnings.join()).toMatch(/--border: translucent/);
  });

  it("warns about gamut clipping", () => {
    const t = buildTheme({ ...base, accent: "oklch(0.6 0.25 30)" });
    expect(t.warnings.join()).toMatch(/--accent: out of sRGB gamut/);
  });

  it("ignores variables it does not map", () => {
    const t = buildTheme({ ...base, "font-sans": "Inter", radius: "1rem", "chart-1": "var(--x)" });
    expect(Object.keys(t.vars)).not.toContain("chart-1");
    expect(Object.keys(t.vars)).not.toContain("radius");
  });

  it("fails on unparseable mapped values and missing essentials", () => {
    expect(() => buildTheme({ ...base, card: "var(--bg)" })).toThrow(/--card/);
    expect(() => buildTheme({ foreground: "#fff", primary: "#fff" })).toThrow(/--background/);
  });

  it("emits a light --px-on-accent only when the primary is too dark for the default", () => {
    expect(buildTheme(base).onAccent).toBeUndefined();
    const dark = buildTheme({ ...base, primary: "hsl(230 60% 25%)" });
    expect(dark.onAccent).toBe("#ffffff");
    expect(dark.warnings.join()).toMatch(/px-on-accent/);
  });
});

describe("renderThemeCss", () => {
  const { vars, onAccent } = buildTheme({
    background: "#0b0e14",
    foreground: "#bfbdb6",
    primary: "hsl(230 60% 25%)",
  });

  it("renders a header and one block in required-variable order", () => {
    const css = renderThemeCss({
      id: "demo",
      label: "Demo",
      source: "tweakcn sample",
      vars,
      onAccent,
    });
    expect(css).toMatch(/^\/\* Demo: imported theme\.\n {3}Source: tweakcn sample/);
    expect(css).toContain("scripts/import-theme.ts");
    expect(css).toContain('[data-theme="demo"] {');
    const names = [...css.matchAll(/^ {2}--([a-z-]+):/gm)].map((m) => m[1]);
    expect(names).toEqual([...REQUIRED_VARS, "px-on-accent"]);
    expect(css).toContain("--px-on-accent: #ffffff;");
  });

  it("omits the override when not needed and neutralises comment terminators", () => {
    const css = renderThemeCss({ id: "demo", label: "a */ b", vars });
    expect(css).not.toContain("px-on-accent");
    expect(css.split("*/").length).toBe(2);
  });

  it("validates the id", () => {
    for (const id of ["", "Bad", "a b", "x".repeat(33), "a/b", 'a"]'])
      expect(() => renderThemeCss({ id, label: "x", vars }), id).toThrow(/Invalid theme id/);
  });

  it("importTheme chains extraction and build", () => {
    expect(importTheme(DARK_CSS).vars["primary"]).toBe("137 43% 51%");
  });
});
