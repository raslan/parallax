import { describe, expect, it } from "vitest";
import { THEME_GROUPS, THEME_META, THEMES } from "./registry";

import { REQUIRED_VARS, SAFE_THEME_ID as SAFE_ID } from "./importer";

// Raw source of every stylesheet in this folder, keyed by "<name>.css".
const sources = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("./*.css", { query: "?raw", import: "default", eager: true }),
  ).map(([path, css]) => [path.replace("./", ""), css]),
);
const themeFiles = Object.keys(sources).filter((f) => f !== "base.css");

describe("theme registry", () => {
  it("has unique, safe ids and known groups", () => {
    expect(new Set(THEMES).size).toBe(THEMES.length);
    for (const t of THEME_META) {
      expect(t.id).toMatch(SAFE_ID);
      expect(THEME_GROUPS).toContain(t.group);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it("has a css block with every required variable for each theme", () => {
    for (const { id } of THEME_META) {
      const css = sources[`${id}.css`];
      expect(css, `${id}.css`).toBeDefined();
      expect(css, id).toContain(`[data-theme="${id}"]`);
      for (const v of REQUIRED_VARS) {
        expect(css, `${id} --${v}`).toMatch(new RegExp(`--${v}:\\s*[^;]+;`));
      }
    }
  });

  it("lists every group in order, each non-empty", () => {
    expect(THEME_GROUPS).toEqual(["Parallax", "Colour", "Classic palettes"]);
    for (const g of THEME_GROUPS)
      expect(
        THEME_META.some((t) => t.group === g),
        g,
      ).toBe(true);
  });

  it("keeps the original eight themes first, in order", () => {
    expect(THEMES.slice(0, 8)).toEqual([
      "parallax",
      "elegance",
      "graphite",
      "rose",
      "oled",
      "violet",
      "cyan",
      "emerald",
    ]);
  });

  it("has a registry entry for every css file", () => {
    expect(themeFiles.map((f) => f.replace(/\.css$/, "")).sort()).toEqual([...THEMES].sort());
  });
});
