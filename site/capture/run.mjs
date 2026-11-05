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
async function cropRect(page, crop, vp = VIEWPORT) {
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
  const width = Math.min(vp.width - x, Math.floor(r.width)) & ~1;
  const height = Math.min(vp.height - y, Math.floor(r.height)) & ~1;
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
  // `shot.viewport` captures the app at another window size (e.g. a phone, to show its own mobile layout).
  const vp = shot.viewport ?? VIEWPORT;
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  await settle(page, shot);
  const rect = await cropRect(page, shot.crop, vp);
  const png = join(tmp, "shot.png");
  await page.screenshot({ path: png, clip: rect });
  await ctx.close();
  const out = join(OUT, `${shot.id}.webp`);
  mkdirSync(dirname(out), { recursive: true });
  const enc = encodeStill(png, out, (shot.budgetKB ?? BUDGET_KB.still) * 1024);
  // Optional smaller copies for responsive `srcset` (shot.variants = widths in CSS px, each ≤ the crop width).
  // The full-size file is `rect.width` CSS px wide at 2x, so it is also the 2x copy of that width.
  const variants = [];
  for (const w of shot.variants ?? []) {
    if (w >= rect.width) continue;
    const file = `${shot.id}-${w}w.webp`;
    const vOut = join(OUT, file);
    ffmpeg([
      "-i",
      out,
      "-vf",
      `scale=${w * 2}:-2:flags=lanczos`,
      "-c:v",
      "libwebp",
      "-quality",
      String(enc.quality),
      vOut,
    ]);
    variants.push({ src: file, width: w, bytes: statSync(vOut).size });
  }
  return {
    src: `${shot.id}.webp`,
    width: rect.width,
    height: rect.height,
    bytes: statSync(out).size,
    ...(variants.length ? { variants } : {}),
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

// ------------------------------------------------- hi-res clips with a virtual camera (landing page)
// Recorded at 2x so the page can zoom into the clip and stay sharp. `steps(page, { sleep, focus })` can call
// `focus(target, { pad, move })`: the runner records the exact time and the target's box, and the page later
// plays that as a smooth camera move (zoom in, hold, zoom out). `focus(null)` returns to the whole view.
// Target: a Playwright locator, a CSS selector, or a rect in page px. The camera is stored normalised to the crop.
const HIRES_MAX_WIDTH = 2000;

// `input` is ffmpeg's input arguments for the already-cropped 2x frames (a concat list of screenshots).
function encodeHiresClip(input, outBase, rect, budgetBytes) {
  const w = Math.min(rect.width * 2, HIRES_MAX_WIDTH) & ~1;
  const vf = `scale=${w}:-2:flags=lanczos,fps=30`;
  const mp4 = `${outBase}.mp4`;
  const webm = `${outBase}.webm`;
  let used = null;
  for (const crf of [34, 36, 38, 40, 42, 44]) {
    ffmpeg([
      ...input,
      "-vf",
      vf,
      "-an",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      String(crf),
      "-row-mt",
      "1",
      "-pix_fmt",
      "yuv420p",
      webm,
    ]);
    if (statSync(webm).size <= budgetBytes) {
      used = { crf };
      break;
    }
  }
  if (!used)
    die(
      `${webm} is ${Math.round(statSync(webm).size / 1024)} KB at CRF 44, over its ${Math.round(budgetBytes / 1024)} KB budget; crop tighter or raise budgetKB`,
    );
  // H.264 fallback for browsers without VP9 (older iOS); allowed a little more room.
  for (const crf of [28, 30, 32, 34, 36, 38]) {
    ffmpeg([
      ...input,
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
      mp4,
    ]);
    if (statSync(mp4).size <= budgetBytes * 1.5) return { ...used, width: w, mp4Crf: crf };
  }
  die(`${mp4} is over its budget at CRF 38`);
}

async function runHiresClip(browser, shot, tmp) {
  // Playwright's own video recording is 1x whatever the pixel ratio, so the frames are 2x screenshots of the crop
  // taken in a loop (about 13 per second) while the steps run, then stitched with their real timings.
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  await settle(page, shot);
  const rect = await cropRect(page, shot.crop);
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const framesDir = join(tmp, `frames-${shot.id.replace(/\W+/g, "-")}`);
  mkdirSync(framesDir, { recursive: true });
  const frames = [];
  let recording = true;
  const grab = (async () => {
    while (recording) {
      const t = now();
      const buf = await page.screenshot({
        type: "jpeg",
        quality: 92,
        clip: rect,
        animations: "allow",
        caret: "initial",
      });
      const file = join(framesDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
      writeFileSync(file, buf);
      frames.push({ t, file });
    }
  })();

  const FULL = { x: 0, y: 0, w: 1, h: 1 };
  const camera = [];
  let current = FULL;
  const toRect = async (target, pad) => {
    if (target == null) return FULL;
    let b;
    if (typeof target === "string") b = await page.locator(target).first().boundingBox();
    else if (typeof target.boundingBox === "function") b = await target.boundingBox();
    else b = target;
    if (!b) die(`${shot.id}: focus target not visible`);
    const x0 = Math.max(rect.x, b.x - pad.x);
    const y0 = Math.max(rect.y, b.y - pad.y);
    const x1 = Math.min(rect.x + rect.width, b.x + b.width + pad.x);
    const y1 = Math.min(rect.y + rect.height, b.y + b.height + pad.y);
    const r = (v) => Math.round(v * 10000) / 10000;
    return {
      x: r((x0 - rect.x) / rect.width),
      y: r((y0 - rect.y) / rect.height),
      w: r((x1 - x0) / rect.width),
      h: r((y1 - y0) / rect.height),
    };
  };
  const focus = async (target, { pad = { x: 24, y: 24 }, move = 0.8 } = {}) => {
    const next = await toRect(target, pad);
    const t = now();
    if (!camera.length) camera.push({ t: 0, ...current });
    camera.push({ t: Math.round(t * 100) / 100, ...current }); // hold until the move starts
    camera.push({ t: Math.round((t + move) * 100) / 100, ...next });
    current = next;
  };

  await shot.steps(page, { sleep, focus });
  if (current !== FULL) await focus(null);
  await sleep(shot.tailMs ?? 1200);
  recording = false;
  await grab;
  const endT = now();
  await ctx.close();

  // ffmpeg concat list: each frame is held until the next one was taken (the last until the end).
  const list = frames
    .map(
      (f, i) =>
        `file '${f.file}'\nduration ${((frames[i + 1]?.t ?? endT) - f.t || 0.04).toFixed(3)}`,
    )
    .join("\n");
  const listFile = join(framesDir, "list.txt");
  writeFileSync(listFile, `${list}\nfile '${frames.at(-1).file}'\n`);

  const outBase = join(OUT, shot.id);
  mkdirSync(dirname(outBase), { recursive: true });
  const enc = encodeHiresClip(
    ["-f", "concat", "-safe", "0", "-i", listFile],
    outBase,
    rect,
    (shot.budgetKB ?? 900) * 1024,
  );
  const poster = `${outBase}.poster.webp`;
  ffmpeg([
    "-ss",
    "0.15",
    "-i",
    `${outBase}.webm`,
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "82",
    poster,
  ]);
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${outBase}.webm`],
    { encoding: "utf8" },
  );
  const duration = Math.round(parseFloat(probe.stdout) * 100) / 100;
  const h = Math.round((enc.width * rect.height) / rect.width / 2) * 2;
  return {
    src: `${shot.id}.mp4`,
    webm: `${shot.id}.webm`,
    poster: `${shot.id}.poster.webp`,
    width: enc.width,
    height: h,
    bytes: statSync(`${outBase}.webm`).size,
    mp4Bytes: statSync(`${outBase}.mp4`).size,
    duration,
    camera,
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
        : shot.hires
          ? await runHiresClip(browser, shot, tmp)
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
