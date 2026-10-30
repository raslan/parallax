import { describe, expect, it } from "vitest";
import cssFixture from "./__fixtures__/tweakcn-sample.css?raw";
import jsonFixture from "./__fixtures__/registry-item-sample.json?raw";
import { REQUIRED_VARS, SAFE_THEME_ID, importTheme, parseColor, renderThemeCss } from "./importer";

/** Same integrity rules registry.test.ts applies to every shipped theme file. */
function expectValidThemeFile(css: string, id: string): void {
  expect(id).toMatch(SAFE_THEME_ID);
  expect(css).toContain(`[data-theme="${id}"]`);
  for (const v of REQUIRED_VARS) {
    expect(css, `--${v}`).toMatch(new RegExp(`--${v}:\\s*[^;]+;`));
  }
}

function render(text: string, id: string) {
  const built = importTheme(text);
  const css = renderThemeCss({
    id,
    label: "Sample",
    source: "test fixture",
    vars: built.vars,
    onAccent: built.onAccent,
  });
  return { built, css };
}

function value(css: string, name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1];
}

describe("tweakcn CSS fixture", () => {
  const { built, css } = render(cssFixture, "sample-tweakcn");

  it("generates a complete, valid theme file", () => {
    expectValidThemeFile(css, "sample-tweakcn");
    expect(built.derived).toEqual([]);
  });

  it("uses the dark half, not the light one", () => {
    // dark --background oklch(0.2223 0.006 271) is near-black; light is near-white.
    const [, , l] = value(css, "background")?.split(" ") ?? [];
    expect(Number.parseInt(l ?? "100")).toBeLessThan(15);
  });

  it("spot-checks converted triplets", () => {
    expect(value(css, "foreground")).toBe("0 0% 94%");
    expect(value(css, "primary")).toBe(value(css, "ring"));
    // oklch(1 0 0 / 15%) over the background, flattened to a solid grey-ish colour.
    expect(value(css, "input")).toMatch(/^\d+ \d+% (2\d|3\d)%$/);
    expect(value(css, "sidebar-border")).toMatch(/^\d+ \d+% (2\d)%$/);
    // each emitted triplet parses back to a solid colour
    for (const v of REQUIRED_VARS) expect(parseColor(value(css, v) ?? "", v).a).toBe(1);
  });

  it("leaves fonts, radius, shadows, charts and destructive out of the output", () => {
    for (const ignored of [
      "font-sans",
      "radius",
      "shadow",
      "chart-1",
      "destructive",
      "sidebar-primary",
      "tracking",
    ]) {
      expect(css, ignored).not.toContain(`--${ignored}`);
    }
    expect(css).not.toContain("oklch");
  });
});

describe("registry-item JSON fixture", () => {
  const { built, css } = render(jsonFixture, "sample-json");

  it("generates a complete, valid theme file with derivations for the gaps", () => {
    expectValidThemeFile(css, "sample-json");
    expect(built.converted).toContain("primary");
    expect(built.derived.map((d) => d.name)).toContain("sidebar");
  });

  it("converts mixed hsl / bare / oklch values", () => {
    expect(value(css, "background")).toBe("224 30% 7%");
    expect(value(css, "foreground")).toBe("210 20% 92%");
    expect(value(css, "border")).toBe("224 20% 18%");
    expect(value(css, "primary")).toBe("137 43% 51%");
    expect(value(css, "sidebar")).toBe("224 30% 7%");
  });
});
