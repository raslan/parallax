#!/usr/bin/env node
// Renders the link-preview image (public/og.png, 1200x630) and the iOS home-screen icon (app/apple-icon.png)
// from the site's own pieces: the Playfair headline, the default theme's colours and the hero screenshot.
// Re-run after the hero screenshot or the headline changes:  npm run og
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(SITE, "../package.json"))("playwright");

// The default theme, read from the generated list so the image follows the site.
const themes = readFileSync(join(SITE, "lib/themes.generated.ts"), "utf8");
const first = themes.match(/"background": "([^"]+)",\s*"card": "([^"]+)",\s*"accent": "([^"]+)"/);
if (!first) throw new Error("could not read the default theme from lib/themes.generated.ts");
const [, BG, , ACCENT] = first;

const fontDir = join(SITE, "node_modules/@fontsource-variable/playfair/files");
const font = (name) => pathToFileURL(join(fontDir, name)).href;
const shot = pathToFileURL(join(SITE, "public/media/landing/hero/files-grid.webp")).href;

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:"PF";src:url("${font("playfair-latin-opsz-normal.woff2")}");font-weight:300 900;font-style:normal}
@font-face{font-family:"PF";src:url("${font("playfair-latin-opsz-italic.woff2")}");font-weight:300 900;font-style:italic}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;background:${BG};color:#f2f3f7;font-family:system-ui,sans-serif;position:relative}
.glow{position:absolute;inset:0;background:radial-gradient(60% 70% at 85% 80%, color-mix(in srgb, ${ACCENT} 22%, transparent), transparent 70%)}
.copy{position:absolute;left:72px;top:0;bottom:0;width:480px;display:flex;flex-direction:column;justify-content:center}
.brand{position:absolute;left:72px;top:56px;display:flex;align-items:center;gap:14px;font-size:26px;font-weight:600;letter-spacing:-.01em}
.brand b{color:${ACCENT};font-family:ui-monospace,monospace;font-size:30px}
h1{font-family:"PF",serif;font-weight:500;font-size:68px;line-height:1.04;letter-spacing:-.02em}
h1 em{color:${ACCENT};font-style:italic}
.tag{margin-top:28px;font-size:25px;color:#9aa0ae;line-height:1.4}
.shot{position:absolute;left:600px;top:150px;width:900px;border-radius:14px 0 0 0;border:1px solid rgba(255,255,255,.14);box-shadow:0 40px 90px -30px #000}
</style><div class="glow"></div>
<div class="brand"><b>P</b>Parallax</div>
<div class="copy"><h1>The Swiss Army knife for <em>your media library.</em></h1>
<p class="tag">Free and open source.</p></div>
<img class="shot" src="${shot}">`;

const tmp = mkdtempSync(join(tmpdir(), "px-og-"));
const page = await (await chromium.launch()).newPage({ viewport: { width: 1200, height: 630 } });
writeFileSync(join(tmp, "og.html"), html);
await page.goto(pathToFileURL(join(tmp, "og.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: join(SITE, "public/og.png"), type: "png" });

// iOS home-screen icon: the favicon artwork, full bleed.
const svg = readFileSync(join(SITE, "app/icon.svg"), "utf8").replace(" rx='3'", "");
await page.setViewportSize({ width: 180, height: 180 });
writeFileSync(
  join(tmp, "icon.html"),
  `<body style="margin:0">${svg.replace("<svg ", "<svg width='180' height='180' ")}`,
);
await page.goto(pathToFileURL(join(tmp, "icon.html")).href);
await page.screenshot({ path: join(SITE, "app/apple-icon.png"), type: "png" });

await page.context().browser().close();
rmSync(tmp, { recursive: true, force: true });
console.log("og: wrote public/og.png and app/apple-icon.png");
