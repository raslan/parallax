#!/usr/bin/env node
// Records a full Parallax demo:
//   create library → jobs (scanning) → files → cleanup (filters + view toggle) → compress (CRF slider)
// Output: demo/demo-library-scan.webm  (+ GIF if ffmpeg is available)
//
// Usage:
//   node scripts/demo-record.js [--url http://localhost:7899] [--media-path /media/videos]

const { chromium } = require("playwright");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const get = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const BASE_URL   = get("--url", "http://localhost:7899");
const MEDIA_PATH = get("--media-path", "/media/videos");
const OUTPUT_DIR = path.join(__dirname, "../demo");
const RAW_DIR    = path.join(OUTPUT_DIR, "_raw");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "demo-library-scan.webm");
const GIF_FILE    = path.join(OUTPUT_DIR, "demo-library-scan.gif");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Smoothly drag a range input from its current value to targetValue over durationMs
async function scrubSlider(page, selector, targetValue, durationMs = 1200) {
  const slider = page.locator(selector);
  const box = await slider.boundingBox();
  const min = Number(await slider.getAttribute("min") ?? 0);
  const max = Number(await slider.getAttribute("max") ?? 100);
  const current = Number(await slider.inputValue());

  const steps = 20;
  const interval = durationMs / steps;

  for (let i = 1; i <= steps; i++) {
    const val = Math.round(current + (targetValue - current) * (i / steps));
    const pct = (val - min) / (max - min);
    const x = box.x + pct * box.width;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    // Also fire the React onChange via fill
    await slider.evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, val);
    await sleep(interval);
  }
}

(async () => {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 800 } },
  });

  const page = await ctx.newPage();

  // ── 1. Libraries page ────────────────────────────────────────────────────────
  console.log("1. Libraries page — creating library...");
  await page.goto(`${BASE_URL}/libraries`);
  await page.waitForSelector("text=Add Library", { timeout: 10_000 });
  await sleep(800);

  await page.click("button:has-text('Add Library')");
  await page.waitForSelector("input[placeholder='/media/movies']", { timeout: 5_000 });
  await sleep(500);

  const pathInput = page.locator("input[placeholder='/media/movies']");
  await pathInput.click();
  await pathInput.fill(MEDIA_PATH);
  await sleep(700);

  // Last "Add Library" button is the form submit
  await page.locator("button:has-text('Add Library')").last().click();
  await sleep(1000);

  // ── 2. Jobs page ─────────────────────────────────────────────────────────────
  console.log("2. Jobs page — showing scan in progress...");
  await page.goto(`${BASE_URL}/jobs`);
  await page.waitForSelector("text=Jobs", { timeout: 5_000 });
  await sleep(800);

  try {
    await page.waitForSelector("text=running", { timeout: 8_000 });
    console.log("   Scan job visible and running.");
  } catch {
    console.warn("   No running job — scan may have completed already.");
  }
  await sleep(2500);

  // ── 3. Files page ─────────────────────────────────────────────────────────────
  console.log("3. Files page — showing indexed files...");
  await page.goto(`${BASE_URL}/files`);
  await page.waitForSelector("text=Files", { timeout: 5_000 });
  await sleep(2000);

  try {
    await page.waitForSelector("img", { timeout: 10_000 });
    console.log("   Files visible.");
  } catch {
    console.warn("   No thumbnails yet — scan may still be in progress.");
  }
  await sleep(2000);

  // Wait for scan to finish before cleanup (Find Files requires no active scan)
  console.log("   Waiting for scan to complete...");
  for (let i = 0; i < 60; i++) {
    const resp = await page.evaluate((url) =>
      fetch(url).then((r) => r.json()), `${BASE_URL}/api/jobs?limit=5`
    );
    const running = (Array.isArray(resp) ? resp : resp.jobs ?? []).some((j) => j.status === "running" || j.status === "pending");
    if (!running) break;
    console.log("   Scan still running, waiting...");
    await sleep(2000);
  }

  // ── 4. Cleanup page ───────────────────────────────────────────────────────────
  console.log("4. Cleanup page — filtering files...");
  await page.goto(`${BASE_URL}/cleanup`);
  await page.waitForSelector("[data-testid='filter-duration']", { timeout: 10_000 });
  await sleep(800);

  // Enable Duration filter
  console.log("   Enabling Duration filter...");
  await page.locator("[data-testid='filter-duration']").click();
  await sleep(600);

  // Find Files
  console.log("   Clicking Find Files (duration)...");
  await page.click("button:has-text('Find Files')");
  try {
    // Results render "X files match" or "No files match"
    await page.waitForSelector("text=/files match|No files match/", { timeout: 8_000 });
  } catch {
    await sleep(3000);
  }
  await sleep(1500);

  // Enable Frame Rate filter too
  console.log("   Enabling Frame Rate filter...");
  await page.locator("[data-testid='filter-frame-rate']").click();
  await sleep(600);

  // Find Files again
  console.log("   Clicking Find Files (duration + frame rate)...");
  await page.click("button:has-text('Find Files')");
  try {
    await page.waitForSelector("text=/files match|No files match/", { timeout: 8_000 });
  } catch {
    await sleep(3000);
  }
  await sleep(1500);

  // Switch to grid view
  console.log("   Switching to grid view...");
  try {
    await page.waitForSelector("[data-testid='view-grid']", { timeout: 5_000 });
    await page.locator("[data-testid='view-grid']").click();
    await sleep(1200);
  } catch {
    console.warn("   View toggle not visible — no results returned.");
  }

  // ── 5. Compress page ──────────────────────────────────────────────────────────
  console.log("5. Compress page — showing CRF slider...");
  await page.goto(`${BASE_URL}/compress`);
  await page.waitForSelector("[data-testid='crf-slider']", { timeout: 10_000 });
  await sleep(1000);

  // Wait for files to load, then select all so savings estimates show
  try {
    // "All" button appears once filteredFiles is non-empty
    await page.waitForSelector("button:has-text('All')", { timeout: 10_000 });
    await page.click("button:has-text('All')");
    await sleep(600);
    console.log("   Selected all files.");
  } catch {
    console.warn("   'All' button not found — no files loaded on compress page.");
  }

  // Scrub slider: lower CRF (higher quality) → higher CRF (smaller file)
  console.log("   Scrubbing CRF slider...");
  await scrubSlider(page, "[data-testid='crf-slider']", 18, 1200);
  await sleep(600);
  await scrubSlider(page, "[data-testid='crf-slider']", 40, 1400);
  await sleep(600);
  await scrubSlider(page, "[data-testid='crf-slider']", 28, 800);
  await sleep(1500);

  // ── Done ─────────────────────────────────────────────────────────────────────
  await ctx.close();
  await browser.close();

  const recordings = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(RAW_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!recordings.length) {
    console.error("No recording found in", RAW_DIR);
    process.exit(1);
  }

  const raw = path.join(RAW_DIR, recordings[0].f);
  fs.renameSync(raw, OUTPUT_FILE);
  console.log(`\nSaved: ${OUTPUT_FILE}`);

  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-i", OUTPUT_FILE,
    "-vf", "fps=20,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
    GIF_FILE,
  ]);

  if (ffmpeg.status === 0) {
    const mb = (fs.statSync(GIF_FILE).size / 1_048_576).toFixed(1);
    console.log(`GIF saved: ${GIF_FILE} (${mb} MB)`);
  } else {
    console.log("ffmpeg not found — convert manually:");
    console.log(`  ffmpeg -i ${OUTPUT_FILE} -vf "fps=20,scale=1280:-1" ${GIF_FILE}`);
  }
})();
