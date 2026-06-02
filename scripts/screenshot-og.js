#!/usr/bin/env node
// Takes a 1200x630 screenshot of dist/index.html and saves it as og-image.png
// Run after build-landing.js: node scripts/build-landing.js && node scripts/screenshot-og.js

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const distDir = path.join(__dirname, "../dist");
const htmlPath = path.join(distDir, "index.html");
const outPath = path.join(__dirname, "../og-image.png"); // repo root — committed and copied to dist/ by build-landing.js

if (!fs.existsSync(htmlPath)) {
  console.error("dist/index.html not found — run build-landing.js first");
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(`file://${htmlPath}`);

  // wait for fonts and entrance animations to settle
  await page.waitForTimeout(1800);

  await page.screenshot({ path: outPath });
  await browser.close();

  console.log(`og-image.png written to ${outPath}`);
})();
