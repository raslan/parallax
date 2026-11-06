#!/usr/bin/env node
// Accessibility audit with axe-core: WCAG 2.2 A/AA rules, every page in PAGES, in every theme, at desktop and
// phone width. Contrast is the one that matters most here, since the colours change with the theme.
//
//   npm run build && npx serve out -l 4173      (in another terminal)
//   npm run a11y -- [--url http://localhost:4173] [--only /lab] [--theme rose]
//
// Pages are loaded with reduced motion, so nothing is mid-fade when axe measures colours. axe cannot judge
// everything (reading order, whether alt text is any good, focus behaviour): a real screen-reader pass is still
// needed before release.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "..");
const requireFromRepo = createRequire(join(SITE, "../package.json"));
const { chromium } = requireFromRepo("playwright");
const axeSource = readFileSync(
  createRequire(join(SITE, "package.json")).resolve("axe-core/axe.min.js"),
  "utf8",
);

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const BASE = opt("--url", "http://localhost:4173").replace(/\/$/, "");
const ONLY_PAGE = opt("--only", "");
const ONLY_THEME = opt("--theme", "");

// The landing page plus one page of each docs kind: prose with screenshots and clips, a tool page, the API
// reference (tables, code), and the acknowledgements list.
const PAGES = [
  "/lab",
  "/docs",
  "/docs/tools/organize",
  "/docs/features/duplicates",
  "/docs/general-concepts/home",
  "/docs/api",
  "/docs/acknowledgements",
];
const THEMES = ["parallax", "elegance", "graphite", "rose", "oled"];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const FRAMEWORK_LANDMARK_RULES = ["region", "landmark-unique", "landmark-no-duplicate-banner"];

const themes = THEMES.filter((t) => !ONLY_THEME || t === ONLY_THEME);
const pages = PAGES.filter((p) => !ONLY_PAGE || p === ONLY_PAGE);

const browser = await chromium.launch();
const found = new Map(); // rule + selector -> { impact, help, where: Set }
let runs = 0;

for (const theme of themes) {
  // Reduced motion first (nothing mid-fade when colours are measured), then the landing page again with its
  // scroll reveals and drifting stars running, once everything has settled.
  for (const [vp, motion] of VIEWPORTS.flatMap((v) => [
    [v, "reduce"],
    [v, "no-preference"],
  ])) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      reducedMotion: motion,
      colorScheme: "dark",
    });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("parallax-site-theme", t);
      } catch {
        // ignore
      }
    }, theme);
    const page = await ctx.newPage();
    for (const path of motion === "reduce" ? pages : pages.filter((p) => p === "/lab")) {
      const res = await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => null);
      if (!res || !res.ok()) {
        console.error(`✘ ${path} did not load (${res?.status() ?? "no response"})`);
        process.exit(2);
      }
      // Lazy images and clips: scroll through once so everything is in place, then back to the top.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += innerHeight) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        scrollTo(0, 0);
      });
      await page.waitForTimeout(motion === "reduce" ? 400 : 1500);
      await page.evaluate(axeSource);
      // The docs' page frame (sidebar, table of contents, mobile sub-nav) is Fumadocs' own markup, and these
      // three landmark rules are "best practice" advice about it, not WCAG failures. Everything else still applies.
      const skip = path.startsWith("/docs") ? FRAMEWORK_LANDMARK_RULES : [];
      const result = await page.evaluate(
        ([tags, off]) =>
          globalThis.axe.run(document, {
            runOnly: { type: "tag", values: tags },
            rules: Object.fromEntries(off.map((id) => [id, { enabled: false }])),
          }),
        [TAGS, skip],
      );
      runs++;
      for (const v of result.violations) {
        for (const node of v.nodes) {
          const key = `${v.id} | ${node.target.join(" ")}`;
          const entry = found.get(key) ?? {
            id: v.id,
            impact: v.impact,
            help: v.help,
            target: node.target.join(" "),
            summary: (node.failureSummary ?? "").split("\n").slice(1, 3).join(" ").trim(),
            where: new Set(),
          };
          entry.where.add(
            `${path} [${theme}, ${vp.name}, ${motion === "reduce" ? "still" : "animated"}]`,
          );
          found.set(key, entry);
        }
      }
    }
    await ctx.close();
  }
}
await browser.close();

if (!found.size) {
  console.log(
    `a11y: ok, ${runs} page runs (${pages.length} pages × ${themes.length} themes × ${VIEWPORTS.length} sizes, plus the landing page animated)`,
  );
  process.exit(0);
}
const byRule = new Map();
for (const e of found.values()) byRule.set(e.id, [...(byRule.get(e.id) ?? []), e]);
console.log(`a11y: ${found.size} problem(s) in ${runs} page runs\n`);
for (const [id, list] of byRule) {
  console.log(`${id}  (${list[0].impact}) ${list[0].help}`);
  for (const e of list) {
    const where = [...e.where];
    console.log(`  ${e.target}`);
    console.log(`    ${e.summary}`);
    console.log(
      `    ${where.slice(0, 4).join("; ")}${where.length > 4 ? `; +${where.length - 4} more` : ""}`,
    );
  }
  console.log("");
}
process.exit(1);
