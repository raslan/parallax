#!/usr/bin/env node
// Capture runner for the public site's screenshots and clips (RAS-77).
//
//   npm run capture -- [--list] [--only <id-or-prefix>] [--url http://localhost:7898]
//                                  [--out <dir>] [--debug]
//
// Drives the DEMO instance (never the real app) with Playwright, crops to the region a shot
// asks for, and writes size-budgeted assets to --out (default site/public/media) and the manifest to site/lib/media-manifest.json.
//   still -> <id>.webp          (libwebp, quality stepped down until it fits the budget)
//   clip  -> <id>.mp4 + <id>.poster.webp   (H.264, muted, CRF stepped up until it fits)
// Shots live in ./shots/*.mjs (default export: array of shot objects; schema in shots/README.md).
// Needs: node, playwright (repo root node_modules), ffmpeg with libwebp + libx264.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  existsSync,
  mkdtempSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const { chromium } = createRequire(join(REPO, "package.json"))("playwright");

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const BASE = opt("--url", "http://localhost:7898").replace(/\/$/, "");
const OUT = resolve(opt("--out", join(HERE, "../public/media")));
const ONLY = opt("--only", "");
const DEBUG = argv.includes("--debug");
const VIEWPORT = { width: 1440, height: 900 };
const BUDGET_KB = { still: 150, clip: 600 };
const MAX_CLIP_WIDTH = 960;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => {
  console.error(`\n✘ ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------- shots
async function loadShots() {
  const dir = join(HERE, "shots");
  const shots = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".mjs"))
    .sort()) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    for (const s of mod.default) shots.push({ ...s, _file: f });
  }
  const seen = new Set();
  for (const s of shots) {
    for (const k of ["id", "kind", "route", "alt", "crop"])
      if (!s[k]) die(`${s._file}: shot missing "${k}": ${JSON.stringify(s.id ?? s)}`);
    if (!["still", "clip"].includes(s.kind)) die(`${s.id}: kind must be still|clip`);
    if (s.kind === "clip" && typeof s.steps !== "function") die(`${s.id}: clip needs steps(page)`);
    if (seen.has(s.id)) die(`duplicate shot id ${s.id}`);
    seen.add(s.id);
  }
  return shots;
}

// ---------------------------------------------------------------- demo guard
// Refuse to run against anything that isn't the seeded demo instance: a screenshot of the real
// app would leak real paths / library names onto a public site.
async function guard() {
  if (new URL(BASE).port === "7899")
    die("refusing to capture port 7899 (that's the real app); the demo runs on :7898");
  const get = async (p) => {
    const r = await fetch(BASE + p).catch(() => null);
    if (!r || !r.ok) die(`${BASE}${p} not reachable — is the demo container up?`);
    return r.json();
  };
  for (const p of ["/api/libraries", "/api/image-libraries", "/api/audio-libraries"]) {
    for (const lib of await get(p)) {
      if (!lib.path.startsWith("/media/")) die(`not the demo instance: library path ${lib.path}`);
      if (!lib.name?.trim())
        die(`library ${lib.path} has no name — re-run site/capture/demo/seed.py`);
    }
  }
  const root = await get("/api/organize/root");
  if (root.root !== "/media")
    die(`Organize root is ${root.root}, expected /media — re-run site/capture/demo/seed.py`);
}

// ---------------------------------------------------------------- page prep
async function settle(page, shot) {
  await page.goto(BASE + shot.route);
  await page.waitForLoadState("networkidle");
  for (const w of shot.waitFor ?? []) {
    await (typeof w === "string" ? page.locator(w) : page.getByText(w))
      .first()
      .waitFor({ timeout: 15000 });
  }
  if (shot.setup) await shot.setup(page);
  // Thumbnails are lazy: wait until every <img> has loaded (or failed), then let layout settle.
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20000 })
    .catch(() => {});
  await sleep(shot.settleMs ?? 600);
  if (shot.blur?.length) {
    await page.addStyleTag({
      content: `${shot.blur.join(",")} { filter: blur(16px) !important; }`,
    });
  }
}

/** Resolve a crop spec to a viewport rect. {rect} | {selectors:[...], pad} (union of boxes). */
async function cropRect(page, crop) {
  let r;
  if (crop.rect) {
    r = { ...crop.rect };
  } else {
    const boxes = [];
    for (const sel of crop.selectors) {
      const loc = typeof sel === "string" ? page.locator(sel).first() : page.getByText(sel).first();
      const b = await loc.boundingBox();
      if (!b) die(`crop selector not found/visible: ${sel}`);
      boxes.push(b);
    }
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const x2 = Math.max(...boxes.map((b) => b.x + b.width));
    const y2 = Math.max(...boxes.map((b) => b.y + b.height));
    const pad = crop.pad ?? 12;
    r = { x: x - pad, y: y - pad, width: x2 - x + 2 * pad, height: y2 - y + 2 * pad };
  }
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const width = Math.min(VIEWPORT.width - x, Math.floor(r.width)) & ~1;
  const height = Math.min(VIEWPORT.height - y, Math.floor(r.height)) & ~1;
  return { x, y, width, height };
}

// ---------------------------------------------------------------- encoders
function ffmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) die(`ffmpeg failed: ${r.stderr}`);
}

function encodeStill(png, out, budgetBytes) {
  for (const q of [90, 85, 80, 75, 70, 65, 60, 55, 50]) {
    ffmpeg(["-i", png, "-c:v", "libwebp", "-quality", String(q), "-compression_level", "6", out]);
    if (statSync(out).size <= budgetBytes) return { quality: q };
  }
  die(
    `${out} is ${Math.round(statSync(out).size / 1024)} KB at quality 50 — over its ${Math.round(budgetBytes / 1024)} KB budget; crop tighter or raise budgetKB`,
  );
}

function encodeClip(src, out, rect, startSec, budgetBytes) {
  const w = Math.min(rect.width, MAX_CLIP_WIDTH) & ~1;
  const vf = `crop=${rect.width}:${rect.height}:${rect.x}:${rect.y},scale=${w}:-2:flags=lanczos,fps=30`;
  for (const crf of [26, 28, 30, 32, 34, 36, 38]) {
    ffmpeg([
      "-ss",
      startSec.toFixed(2),
      "-i",
      src,
      "-vf",
      vf,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    ]);
    if (statSync(out).size <= budgetBytes) return { crf, width: w };
  }
  die(
    `${out} is ${Math.round(statSync(out).size / 1024)} KB at CRF 38 — over its ${Math.round(budgetBytes / 1024)} KB budget; shorten/crop the clip or raise budgetKB`,
  );
}

// ---------------------------------------------------------------- shot runners
async function runStill(browser, shot, tmp) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  await settle(page, shot);
  const rect = await cropRect(page, shot.crop);
  const png = join(tmp, "shot.png");
  await page.screenshot({ path: png, clip: rect });
  await ctx.close();
  const out = join(OUT, `${shot.id}.webp`);
  mkdirSync(dirname(out), { recursive: true });
  const enc = encodeStill(png, out, (shot.budgetKB ?? BUDGET_KB.still) * 1024);
  return {
    src: `${shot.id}.webp`,
    width: rect.width,
    height: rect.height,
    bytes: statSync(out).size,
    ...enc,
  };
}

async function runClip(browser, shot, tmp) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: "dark",
    recordVideo: { dir: tmp, size: VIEWPORT },
  });
  const t0 = Date.now();
  const page = await ctx.newPage();
  await settle(page, shot);
  const rect = await cropRect(page, shot.crop);
  const startSec = (Date.now() - t0) / 1000;
  await shot.steps(page, { sleep });
  await sleep(shot.tailMs ?? 900);
  const video = page.video();
  await ctx.close();
  const src = await video.path();
  const out = join(OUT, `${shot.id}.mp4`);
  mkdirSync(dirname(out), { recursive: true });
  const enc = encodeClip(src, out, rect, startSec, (shot.budgetKB ?? BUDGET_KB.clip) * 1024);
  const poster = join(OUT, `${shot.id}.poster.webp`);
  ffmpeg([
    "-sseof",
    "-0.2",
    "-i",
    out,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "80",
    poster,
  ]);
  const h = Math.round((enc.width * rect.height) / rect.width / 2) * 2;
  return {
    src: `${shot.id}.mp4`,
    poster: `${shot.id}.poster.webp`,
    width: enc.width,
    height: h,
    bytes: statSync(out).size,
    crf: enc.crf,
  };
}

// ---------------------------------------------------------------- main
const shots = await loadShots();
if (argv.includes("--list")) {
  for (const s of shots) console.log(`${s.kind.padEnd(5)} ${s.id}  (${s._file})`);
  process.exit(0);
}
const selected = shots.filter((s) => !ONLY || s.id === ONLY || s.id.startsWith(ONLY));
if (!selected.length) die(`no shot matches --only ${ONLY}`);

await guard();
mkdirSync(OUT, { recursive: true });
const manifestPath = join(HERE, "../lib/media-manifest.json"); // imported by <Shot>; not served
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

const browser = await chromium.launch();
const tmp = mkdtempSync(join(tmpdir(), "px-capture-"));
let failed = 0;
for (const shot of selected) {
  process.stdout.write(`${shot.kind.padEnd(5)} ${shot.id} … `);
  try {
    const res =
      shot.kind === "still"
        ? await runStill(browser, shot, tmp)
        : await runClip(browser, shot, tmp);
    manifest[shot.id] = { id: shot.id, kind: shot.kind, alt: shot.alt, route: shot.route, ...res };
    console.log(`${Math.round(res.bytes / 1024)} KB  ${res.width}×${res.height}`);
  } catch (e) {
    failed++;
    console.log(`FAILED: ${e.message.split("\n")[0]}`);
    if (DEBUG) console.error(e);
  }
}
await browser.close();
if (!DEBUG) rmSync(tmp, { recursive: true, force: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const total = Object.values(manifest).reduce((n, m) => n + m.bytes, 0);
console.log(
  `\nmanifest: ${Object.keys(manifest).length} assets, ${(total / 1024).toFixed(0)} KB total → ${OUT}`,
);
process.exit(failed ? 1 : 0);
