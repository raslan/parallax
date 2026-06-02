#!/usr/bin/env node
// Reads README.md, extracts structured content, and writes dist/index.html

const fs = require("fs");
const path = require("path");

const README = fs.readFileSync(path.join(__dirname, "../README.md"), "utf8");

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mdInline(str) {
  return escapeHtml(str)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

// ── Parse README ─────────────────────────────────────────────────────────────

function getSection(heading) {
  const parts = README.split(/^## /m);
  const part = parts.find((p) => p.startsWith(heading));
  return part ? part.slice(heading.length).trim() : "";
}

function parseFeatureGroups() {
  const section = getSection("Features");
  const groups = [];
  const subParts = section.split(/^### /m);
  for (const sub of subParts) {
    const nl = sub.indexOf("\n");
    if (nl === -1) continue;
    const title = sub.slice(0, nl).trim();
    const body = sub.slice(nl);
    const items = [...body.matchAll(/^- \*\*(.+?)\*\* — (.+)/gm)].map(
      ([, name, desc]) => ({ name, desc })
    );
    if (items.length) groups.push({ title, items });
  }
  return groups;
}

function parseRuntimeTable() {
  const section = getSection("Deployment");
  const rows = [...section.matchAll(/\| `(ghcr\.io[^`]+)` \| ([^|]+) \|/g)].map(
    ([, tag, desc]) => ({ tag: tag.trim(), desc: desc.trim() })
  );
  return rows;
}

const featureGroups = parseFeatureGroups();
const runtimeRows = parseRuntimeTable();

// ── Per-group section metadata ────────────────────────────────────────────────

const GROUP_ICONS = {
  Videos: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m9 8 6 4-6 4V8Z"/></svg>`,
  Images: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`,
  AI:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"/></svg>`,
  Downloads: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>`,
  General: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>`,
};

const GROUP_META = {
  Videos: {
    heading: "Unlimited power over your video library",
    sub: "Hardware-accelerated video compression, duplicate detection, TMDB-powered renaming, and local subtitle generation.",
    style: "split-left",
  },
  Images: {
    heading: "Your image library, actually searchable",
    sub: "Thumbnail grid, perceptual deduplication, and search by describing what you're looking for. All on your machine. No cloud. No data harvested.",
    style: "centered",
  },
  AI: {
    heading: "Smart features with no cloud and no strings",
    sub: "Content search and detection via local-only and offline AI models that run on any hardware.",
    style: "accent-panel",
  },
  Downloads: {
    heading: "Download anything.",
    sub: "yt-dlp integration with quality control, codec selection, browser impersonation, ephemeral cookies, trimming, and live progress.",
    style: "split-right",
  },
  General: {
    heading: "No upsells. No nonsense.",
    sub: "No premium tier. No engagement metrics. No reason to open your wallet.",
    style: "compact",
  },
};

// ── Per-group section HTML builder ────────────────────────────────────────────

function buildGroupSection(group, idx) {
  const sectionNum = String(idx + 2).padStart(2, "0");
  const meta = GROUP_META[group.title] || { style: "split-left", heading: group.title, sub: "" };
  const { heading, sub, style } = meta;
  const icon = GROUP_ICONS[group.title] || "";
  const sectionId = `feat-${group.title.toLowerCase()}`;

  const labelHtml = `<div class="section-label">${escapeHtml(group.title)}</div>`;
  const iconHtml = icon ? `<div class="feat-icon">${icon}</div>` : "";
  const headingHtml = `<h2 class="section-heading">${escapeHtml(heading)}</h2>`;
  const subHtml = `<p class="section-sub">${escapeHtml(sub)}</p>`;
  const metaHtml = `<div class="feat-meta reveal">${iconHtml}${labelHtml}${headingHtml}${subHtml}</div>`;

  let inner = "";

  if (style === "split-left" || style === "split-right") {
    const rowsHtml = group.items
      .map(
        ({ name, desc }, i) => `
      <div class="feat-row reveal" style="--rd:${(0.05 + i * 0.055).toFixed(2)}s">
        <span class="feat-name">${escapeHtml(name)}</span>
        <span class="feat-desc">${mdInline(desc)}</span>
      </div>`
      )
      .join("");
    const revClass = style === "split-right" ? " feat-reversed" : "";
    inner = `<div class="feat-split${revClass}">${metaHtml}<div class="feat-rows">${rowsHtml}</div></div>`;
  } else if (style === "centered") {
    const cardsHtml = group.items
      .map(
        ({ name, desc }, i) => `
      <div class="feat-tile reveal" style="--rd:${(0.1 + i * 0.09).toFixed(2)}s">
        <strong>${escapeHtml(name)}</strong>
        <span>${mdInline(desc)}</span>
      </div>`
      )
      .join("");
    inner = `
    <div class="feat-centered-header reveal">
      ${iconHtml}${labelHtml}${headingHtml}
      <p class="section-sub">${escapeHtml(sub)}</p>
    </div>
    <div class="feat-tiles">${cardsHtml}</div>`;
  } else if (style === "accent-panel") {
    const listHtml = group.items
      .map(
        ({ name, desc }, i) => `
      <div class="feat-ai-row reveal" style="--rd:${(0.1 + i * 0.1).toFixed(2)}s">
        <div class="feat-ai-dot"></div>
        <div><strong>${escapeHtml(name)}</strong><span>${mdInline(desc)}</span></div>
      </div>`
      )
      .join("");
    inner = `
    <div class="feat-panel reveal">
      <div class="panel-dots" aria-hidden="true">
        <div class="panel-dot" style="top:10%;left:88%;--dur:15s;--dx:-22px;--dy:28px"></div>
        <div class="panel-dot" style="top:78%;left:6%;--dur:20s;--dx:28px;--dy:-18px"></div>
        <div class="panel-dot" style="top:42%;left:70%;--dur:11s;--dx:-18px;--dy:14px"></div>
        <div class="panel-dot" style="top:90%;left:82%;--dur:17s;--dx:-12px;--dy:-22px"></div>
        <div class="panel-dot" style="top:20%;left:22%;--dur:24s;--dx:18px;--dy:32px"></div>
        <div class="panel-dot" style="top:58%;left:48%;--dur:13s;--dx:14px;--dy:-12px"></div>
      </div>
      <div class="feat-split">
        <div class="feat-meta">${iconHtml}${labelHtml}${headingHtml}${subHtml}</div>
        <div class="feat-ai-rows">${listHtml}</div>
      </div>
    </div>`;
  } else if (style === "compact") {
    const rowsHtml = group.items
      .map(
        ({ name, desc }, i) => `
      <div class="feat-row reveal" style="--rd:${(0.15 + i * 0.1).toFixed(2)}s">
        <span class="feat-name">${escapeHtml(name)}</span>
        <span class="feat-desc">${mdInline(desc)}</span>
      </div>`
      )
      .join("");
    inner = `
    <div class="feat-compact">
      <div class="feat-meta reveal">${iconHtml}${labelHtml}${headingHtml}${subHtml}</div>
      <div class="feat-rows">${rowsHtml}</div>
    </div>`;
  }

  return `
<section class="section" id="${sectionId}">
  <div class="sect-num" aria-hidden="true">${sectionNum}</div>
  <div class="container">${inner}</div>
</section>`;
}

const featureGroupSectionsHtml = featureGroups
  .filter((g) => g.title !== "General")
  .map((g, i) => buildGroupSection(g, i))
  .join("\n");

// ── Runtime cards ─────────────────────────────────────────────────────────────

const runtimeLabels = { cpu: "CPU", cuda: "NVIDIA", rocm: "AMD" };
const runtimeDescs = {
  cpu: "No GPU required. AI inference runs on CPU.",
  cuda: "ONNX CUDA backend + NVENC hardware transcoding.",
  rocm: "ONNX ROCm backend + VA-API hardware transcoding.",
};
const runtimeColorClass = { cpu: "cpu", cuda: "nvidia", rocm: "amd" };

const runtimeCardsHtml = runtimeRows
  .map(({ tag }) => {
    const key = tag.endsWith("-cuda") ? "cuda" : tag.endsWith("-rocm") ? "rocm" : "cpu";
    return `
    <div class="runtime-card">
      <div class="runtime-label ${runtimeColorClass[key]}">${runtimeLabels[key]}</div>
      <code class="runtime-tag">${escapeHtml(tag)}</code>
      <p class="runtime-desc">${runtimeDescs[key]}</p>
    </div>`;
  })
  .join("\n");

const ghUrl = "https://github.com/raslan/parallax";

const GITHUB_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>`;

const LOGO_SVG = `<svg class="logo-mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <text x="1" y="16" font-family="monospace" font-size="15" font-weight="700" fill="#c4b5fd">P</text>
  <circle cx="17" cy="4" r="1.2" fill="#c4b5fd"/>
  <line x1="17" y1="1.3" x2="17" y2="6.7" stroke="#c4b5fd" stroke-width="0.7" opacity="0.5"/>
  <line x1="14.3" y1="4" x2="19.7" y2="4" stroke="#c4b5fd" stroke-width="0.7" opacity="0.5"/>
</svg>`;

// ── HTML ──────────────────────────────────────────────────────────────────────

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Parallax — Self-hosted media manager</title>
  <meta name="description" content="A self-hosted video and image library manager with transcoding, duplicate detection, subtitle management, and media identification. Runs in Docker." />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600;1,700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />

  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Ctext x='1' y='16' font-family='monospace' font-size='15' font-weight='700' fill='%23c4b5fd'%3EP%3C/text%3E%3Ccircle cx='17' cy='4' r='1.2' fill='%23c4b5fd'/%3E%3C/svg%3E" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Parallax" />
  <meta property="og:title" content="Parallax — Self-hosted media manager" />
  <meta property="og:description" content="Scan, transcode, deduplicate, and download. A complete media library manager that runs on your hardware, not theirs." />
  <meta property="og:image" content="https://parallax.raslan.dev/og-image.png" />
  <meta property="og:url" content="https://parallax.raslan.dev" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Parallax — Self-hosted media manager" />
  <meta name="twitter:description" content="Scan, transcode, deduplicate, and download. A complete media library manager that runs on your hardware, not theirs." />
  <meta name="twitter:image" content="https://parallax.raslan.dev/og-image.png" />

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { max-width: 100%; overflow-x: hidden; }

    :root {
      --bg:       #060606;
      --bg-r:     #0e0e0e;
      --bg-c:     #141414;
      --rule:     #1c1c1c;
      --rule-hi:  #2a2a2a;
      --text:     #f0ece4;
      --muted:    #464646;
      --mid:      #888;
      --accent:   #8b5cf6;
      --acc-hi:   #c4b5fd;
      --acc-lo:   rgba(139,92,246,0.06);
      --serif:    "Playfair Display", Georgia, "Times New Roman", serif;
      --sans:     "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --mono:     "JetBrains Mono", "Fira Code", "SF Mono", monospace;
      --r:        3px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    /* film grain overlay */
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='250' height='250' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
      opacity: 0.055;
      pointer-events: none;
      z-index: 9000;
    }

    a { color: inherit; text-decoration: none; }
    code { font-family: var(--mono); font-size: 0.8em; }

    .container { max-width: 1100px; margin: 0 auto; padding: 0 2.5rem; }

    /* ── Nav ── */
    nav {
      position: sticky; top: 0; z-index: 100;
      border-bottom: 1px solid var(--rule);
      background: rgba(6,6,6,0.8);
      backdrop-filter: blur(24px);
      transition: background 0.3s, border-color 0.3s;
    }
    nav.scrolled {
      background: rgba(6,6,6,0.96);
      border-bottom-color: var(--rule-hi);
    }
    .nav-inner {
      max-width: 1100px; margin: 0 auto; padding: 0 2.5rem;
      display: flex; align-items: center; justify-content: space-between;
      height: 3.25rem;
    }
    .logo {
      display: flex; align-items: center; gap: 0.5rem;
      font-family: var(--sans); font-weight: 700; font-size: 0.8rem;
      letter-spacing: 0.12em; text-transform: uppercase; color: var(--text);
    }
    .logo-mark { width: 22px; height: 22px; }
    .nav-links { display: flex; align-items: center; gap: 0.125rem; }
    .nav-links a {
      font-size: 0.68rem; font-weight: 600; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--mid);
      padding: 0.35rem 0.7rem; border-radius: var(--r);
      transition: color 0.15s;
    }
    .nav-links a:hover { color: var(--text); }
    .btn {
      display: inline-flex; align-items: center; gap: 0.375rem;
      font-family: var(--sans); font-size: 0.68rem; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      padding: 0.45rem 1rem; border-radius: var(--r);
      transition: opacity 0.15s, background 0.15s, color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    .btn-outline { color: var(--mid); border: 1px solid var(--rule-hi); background: transparent; }
    .btn-outline:hover { color: var(--text); border-color: #404040; }
    .btn-solid { background: var(--text); color: var(--bg); }
    .btn-solid:hover { opacity: 0.85; }

    /* ── Hero ── */
    .hero {
      min-height: 92vh;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4rem;
      align-items: center;
      padding: 8rem 2.5rem 6rem;
      max-width: 1100px;
      margin: 0 auto;
      position: relative;
    }

    /* scroll progress bar */
    .scroll-progress {
      position: fixed; top: 0; left: 0; height: 2px; width: 0%;
      background: linear-gradient(90deg, var(--accent), var(--acc-hi));
      z-index: 9999; pointer-events: none;
      transition: width 0.1s linear;
    }

    /* scanline texture across the whole page top */
    .hero-scan {
      position: fixed; top: 0; left: 0; right: 0; height: 100vh;
      background: repeating-linear-gradient(
        0deg, transparent, transparent 3px,
        rgba(255,255,255,0.022) 3px, rgba(255,255,255,0.022) 4px
      );
      pointer-events: none; z-index: 1; opacity: 1;
    }

    .hero-left { position: relative; z-index: 2; }
    .hero-right { position: relative; z-index: 2; }

    /* hero glow blob */
    .hero-left::before {
      content: "";
      position: absolute;
      top: -10%; left: -15%;
      width: 600px; height: 500px;
      background: radial-gradient(ellipse at center, rgba(139,92,246,0.1) 0%, transparent 65%);
      pointer-events: none; z-index: 0;
      animation: glowPulse 6s ease-in-out infinite;
    }
    .hero-left > * { position: relative; z-index: 1; }
    @keyframes glowPulse {
      0%, 100% { opacity: 0.7; transform: scale(1); }
      50%       { opacity: 1;   transform: scale(1.08); }
    }

    .eyebrow {
      display: flex; align-items: center; gap: 0.625rem;
      font-size: 0.65rem; font-weight: 600; letter-spacing: 0.16em;
      text-transform: uppercase; color: var(--mid);
      margin-bottom: 2rem;
      opacity: 0; animation: rise 0.8s cubic-bezier(0.16,1,0.3,1) 0.05s forwards;
    }
    .eyebrow-pip {
      width: 4px; height: 4px; border-radius: 50%;
      background: var(--acc-hi); opacity: 0.7;
    }
    .eyebrow-sep { color: var(--muted); }

    h1 {
      font-family: var(--serif);
      font-size: clamp(3.2rem, 6.5vw, 6rem);
      font-weight: 700;
      line-height: 0.96;
      letter-spacing: -0.02em;
      margin-bottom: 2rem;
    }
    .hero-line {
      display: block;
      opacity: 0;
      animation: rise 1s cubic-bezier(0.16,1,0.3,1) forwards;
    }
    .hero-line:nth-child(1) { animation-delay: 0.15s; }
    .hero-line:nth-child(2) { animation-delay: 0.32s; }
    h1 em { font-style: italic; color: var(--mid); }
    .h1-accent {
      font-style: normal;
      background: linear-gradient(90deg, var(--acc-hi) 0%, #e9d5ff 40%, var(--acc-hi) 80%);
      background-size: 200% auto;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: shimmer 4s linear infinite;
    }
    @keyframes shimmer {
      from { background-position: 0% center; }
      to   { background-position: 200% center; }
    }

    .hero-sub {
      font-size: 0.9rem; color: var(--mid); line-height: 1.75;
      max-width: 400px; margin-bottom: 2rem;
      opacity: 0; animation: rise 0.9s cubic-bezier(0.16,1,0.3,1) 0.48s forwards;
    }
    .hero-cta {
      display: flex; gap: 0.625rem; flex-wrap: wrap;
      opacity: 0; animation: rise 0.9s cubic-bezier(0.16,1,0.3,1) 0.6s forwards;
    }

    /* hero terminal */
    .terminal {
      border: 1px solid var(--rule-hi); border-radius: 5px;
      overflow: hidden; background: var(--bg-r);
      box-shadow: 0 32px 80px rgba(0,0,0,0.7);
      opacity: 0; animation: rise 1s cubic-bezier(0.16,1,0.3,1) 0.55s forwards;
    }
    .terminal-bar {
      background: var(--bg-c); border-bottom: 1px solid var(--rule);
      padding: 0.55rem 1rem;
      display: flex; align-items: center; gap: 0.625rem;
    }
    .t-dots { display: flex; gap: 0.375rem; }
    .t-dots span { width: 8px; height: 8px; border-radius: 50%; }
    .t-dots .r { background: #ff5f57; } .t-dots .y { background: #febc2e; } .t-dots .g { background: #28c840; }
    .t-label { font-size: 0.68rem; color: var(--mid); font-family: var(--mono); }
    .terminal pre {
      padding: 1.25rem 1.5rem;
      font-family: var(--mono); font-size: 0.775rem; line-height: 1.75;
      color: #c9c5bd; overflow-x: auto; white-space: pre;
    }
    .t-c { color: var(--muted); } .t-k { color: var(--acc-hi); } .t-v { color: #86efac; }

    @keyframes rise {
      from { opacity: 0; transform: translateY(1.25rem); }
      to   { opacity: 1; transform: none; }
    }

    /* ── Scroll reveal ── */
    .reveal {
      opacity: 0; transform: translateY(1.25rem);
      transition: opacity 0.85s cubic-bezier(0.16,1,0.3,1),
                  transform 0.85s cubic-bezier(0.16,1,0.3,1);
      transition-delay: var(--rd, 0s);
    }
    .reveal.is-visible { opacity: 1; transform: none; }

    /* ── Sections ── */
    .section {
      padding: 7rem 0; border-top: 1px solid var(--rule);
      position: relative; overflow: hidden;
    }

    /* large watermark section number */
    .sect-num {
      position: absolute; top: -1.5rem; right: 1rem;
      font-family: var(--serif); font-weight: 700;
      font-size: clamp(7rem, 16vw, 14rem); line-height: 1;
      color: rgba(255,255,255,0.055);
      pointer-events: none; user-select: none; z-index: 0;
    }

    .section > .container { position: relative; z-index: 1; }

    /* section typography */
    .section-label {
      display: flex; align-items: center; gap: 0.75rem;
      font-size: 0.62rem; font-weight: 600; letter-spacing: 0.18em;
      text-transform: uppercase; color: var(--acc-hi);
      margin-bottom: 1rem;
    }
    .section-label::before {
      content: ""; display: block; height: 1px;
      background: var(--acc-hi); opacity: 0.55;
      width: 0; transition: width 0.6s cubic-bezier(0.16,1,0.3,1) 0.2s;
    }
    .is-visible .section-label::before,
    .reveal.is-visible .section-label::before { width: 18px; }
    .section-heading {
      font-family: var(--serif); font-size: clamp(1.9rem, 3.5vw, 3rem);
      font-weight: 700; letter-spacing: -0.015em; line-height: 1.1;
      margin-bottom: 1rem; color: var(--text);
    }
    .section-sub {
      font-size: 0.875rem; color: var(--mid); line-height: 1.7;
      max-width: 400px;
    }

    /* ── Section-specific flair ── */

    /* Videos: slow projector scan line */
    #feat-videos { overflow: hidden; }
    #feat-videos::before {
      content: "";
      position: absolute; left: 0; right: 0; height: 140px;
      background: linear-gradient(180deg, transparent, rgba(255,255,255,0.022), transparent);
      pointer-events: none; z-index: 0;
      animation: scanDown 12s linear infinite;
    }
    @keyframes scanDown {
      from { top: -140px; }
      to   { top: 100%; }
    }

    /* Images: radial glow from center */
    #feat-images { overflow: hidden; }
    #feat-images::before {
      content: "";
      position: absolute; top: 45%; left: 50%;
      transform: translate(-50%, -50%);
      width: 700px; height: 500px;
      background: radial-gradient(ellipse, rgba(124,58,237,0.07) 0%, transparent 65%);
      pointer-events: none; z-index: 0;
    }
    .feat-tile {
      transition: transform 0.28s cubic-bezier(0.16,1,0.3,1), background 0.15s;
    }
    .feat-tile:hover { transform: scale(1.016) translateY(-2px); }

    /* AI: floating constellation dots */
    .feat-panel { overflow: hidden; position: relative; }
    .panel-dots { position: absolute; inset: 0; pointer-events: none; }
    .panel-dot {
      position: absolute; width: 3px; height: 3px;
      border-radius: 50%; background: var(--acc-hi); opacity: 0.18;
      animation: panelDrift var(--dur, 14s) ease-in-out infinite alternate;
    }
    @keyframes panelDrift {
      from { transform: translate(0, 0); }
      to   { transform: translate(var(--dx, 20px), var(--dy, 20px)); }
    }
    .feat-panel::after {
      content: "";
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 25% 35%, rgba(139,92,246,0.09) 0%, transparent 55%);
      animation: panelGlow 7s ease-in-out infinite alternate;
      pointer-events: none;
    }
    @keyframes panelGlow {
      from { opacity: 0.4; } to { opacity: 1; }
    }

    /* Downloads: progress bar pulse on top border */
    #feat-downloads { overflow: hidden; }
    #feat-downloads::before {
      content: "";
      position: absolute; top: 0; left: 0; height: 1px; width: 0%;
      background: linear-gradient(90deg, transparent, var(--accent), var(--acc-hi), transparent);
      pointer-events: none; z-index: 1;
      animation: dlSweep 5s ease-in-out infinite;
    }
    @keyframes dlSweep {
      0%   { width: 0%;   left: 0;    opacity: 0; }
      15%  { opacity: 1; }
      85%  { opacity: 1; }
      100% { width: 100%; left: 0;    opacity: 0; }
    }

    /* ── Feature icon ── */
    .feat-icon {
      width: 26px; height: 26px; color: var(--acc-hi);
      opacity: 0.65; margin-bottom: 1.25rem;
    }
    .feat-icon svg { width: 100%; height: 100%; }

    /* ── Split layout ── */
    .feat-split {
      display: grid; grid-template-columns: 260px 1fr;
      gap: 5rem; align-items: start;
    }
    .feat-reversed { grid-template-columns: 1fr 260px; }
    .feat-reversed .feat-meta { order: 2; }
    .feat-reversed .feat-rows { order: 1; }

    /* ── Feature rows (editorial table) ── */
    .feat-rows { width: 100%; }
    .feat-row {
      display: grid; grid-template-columns: 175px 1fr;
      gap: 0.375rem 1.75rem; padding: 0.875rem 0.75rem;
      border-bottom: 1px solid var(--rule);
      position: relative; overflow: hidden;
      transition: background 0.15s;
    }
    .feat-row:first-child { border-top: 1px solid var(--rule); }
    .feat-row::before {
      content: ""; position: absolute;
      left: 0; top: 0; bottom: 0; width: 2px;
      background: var(--accent);
      transform: scaleY(0); transform-origin: bottom;
      transition: transform 0.25s cubic-bezier(0.16,1,0.3,1);
    }
    .feat-row:hover { background: rgba(255,255,255,0.018); }
    .feat-row:hover::before { transform: scaleY(1); }
    .feat-name {
      font-size: 0.78rem; font-weight: 600; color: var(--text);
      letter-spacing: 0.01em; line-height: 1.5;
    }
    .feat-desc { font-size: 0.775rem; color: var(--mid); line-height: 1.6; }
    .feat-desc code, .feat-ai-row span code {
      font-family: var(--mono); font-size: 0.75em;
      background: rgba(255,255,255,0.06); padding: 0.1em 0.35em;
      border-radius: 2px; color: #a1a1aa;
    }

    /* ── Centered layout (Images) ── */
    .feat-centered-header {
      text-align: center; max-width: 580px; margin: 0 auto 3rem;
    }
    .feat-centered-header .feat-icon { margin: 0 auto 1.25rem; }
    .feat-centered-header .section-label { justify-content: center; }
    .feat-centered-header .section-label::before { display: none; }
    .feat-centered-header .section-sub { max-width: 100%; margin: 0 auto; }

    .feat-tiles {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 0;
      border: 1px solid var(--rule); border-radius: var(--r); overflow: hidden;
    }
    .feat-tile {
      padding: 1.5rem 1.75rem;
      border-right: 1px solid var(--rule);
      border-bottom: 1px solid var(--rule);
      position: relative; transition: background 0.15s;
    }
    .feat-tile::after {
      content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, var(--accent), transparent);
      opacity: 0; transition: opacity 0.2s;
    }
    .feat-tile:hover { background: rgba(255,255,255,0.02); }
    .feat-tile:hover::after { opacity: 1; }
    .feat-tile:nth-child(2n) { border-right: none; }
    .feat-tile:nth-last-child(-n+2) { border-bottom: none; }
    .feat-tile strong {
      display: block; font-size: 0.8rem; font-weight: 600;
      color: var(--text); margin-bottom: 0.4rem; letter-spacing: 0.01em;
    }
    .feat-tile span { font-size: 0.775rem; color: var(--mid); line-height: 1.6; }

    /* ── Accent panel (AI / Smart features) ── */
    .feat-panel {
      background: var(--bg-r); border: 1px solid var(--rule-hi);
      border-radius: 6px; padding: 2.75rem 3rem;
    }
    .feat-panel .feat-split { grid-template-columns: 240px 1fr; gap: 4rem; }

    .feat-ai-rows { width: 100%; }
    .feat-ai-row {
      display: grid; grid-template-columns: 10px 1fr;
      gap: 0 1.25rem; align-items: start;
      padding: 0.875rem 0.625rem; border-radius: var(--r);
      border-bottom: 1px solid var(--rule);
      transition: background 0.15s;
    }
    .feat-ai-row:last-child { border-bottom: none; }
    .feat-ai-row:hover { background: rgba(167,139,250,0.04); }
    .feat-ai-dot {
      width: 6px; height: 6px; border-radius: 50%; background: var(--acc-hi);
      margin-top: 0.42rem; flex-shrink: 0;
      box-shadow: 0 0 8px rgba(196,181,253,0.55);
    }
    .feat-ai-row strong {
      display: block; font-size: 0.8rem; font-weight: 600;
      color: var(--text); margin-bottom: 0.2rem;
    }
    .feat-ai-row span { font-size: 0.775rem; color: var(--mid); line-height: 1.55; }

    /* ── Compact layout (General) ── */
    .feat-compact { display: flex; gap: 5rem; align-items: start; }
    .feat-compact .feat-meta { flex: 0 0 260px; }
    .feat-compact .feat-rows { flex: 1; }

    /* ── Deploy ── */
    .deploy-layout {
      display: grid; grid-template-columns: 280px 1fr;
      gap: 5rem; align-items: start;
    }
    .deploy-layout > * { min-width: 0; }
    .runtime-cards { display: flex; flex-direction: column; gap: 0.625rem; }
    .runtime-card {
      border: 1px solid var(--rule); border-radius: var(--r); padding: 1rem 1.25rem;
      display: grid; grid-template-columns: 3.5rem 1fr;
      grid-template-rows: auto auto; gap: 0.1rem 1rem;
      transition: border-color 0.15s, background 0.15s;
    }
    .runtime-card:hover { border-color: var(--rule-hi); background: var(--bg-r); }
    .runtime-label {
      font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; padding-top: 0.1rem; grid-row: 1;
    }
    .runtime-label.nvidia { color: #4ade80; }
    .runtime-label.amd    { color: #fb923c; }
    .runtime-label.cpu    { color: var(--mid); }
    .runtime-tag {
      font-family: var(--mono); font-size: 0.75rem; color: #c9c5bd;
      grid-column: 2; grid-row: 1; word-break: break-all;
    }
    .runtime-desc {
      font-size: 0.75rem; color: var(--mid); grid-column: 2; grid-row: 2; line-height: 1.45;
    }
    .deploy-snippet {
      border: 1px solid var(--rule-hi); border-radius: var(--r);
      overflow: hidden; background: var(--bg-r);
    }
    .snippet-tabs {
      display: flex; border-bottom: 1px solid var(--rule); background: var(--bg-c);
    }
    .snippet-tab {
      padding: 0.5rem 1rem; font-size: 0.68rem; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--mid);
      cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
      user-select: none; transition: color 0.15s;
    }
    .snippet-tab.active { color: var(--text); border-bottom-color: var(--acc-hi); }
    .snippet-body { display: none; }
    .snippet-body.active { display: block; }
    .snippet-body pre {
      padding: 1.25rem 1.5rem; font-family: var(--mono);
      font-size: 0.775rem; line-height: 1.75; color: #c9c5bd;
      overflow-x: auto; white-space: pre;
    }
    .s-c { color: var(--muted); } .s-k { color: var(--acc-hi); }
    .s-v { color: #86efac; } .s-s { color: #fbbf24; }

    /* ── Footer ── */
    footer { border-top: 1px solid var(--rule); padding: 2.5rem 0; }
    .footer-inner {
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 1rem;
    }
    .footer-logo {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--text);
    }
    .footer-logo svg { width: 20px; height: 20px; }
    footer p { font-size: 0.78rem; color: var(--mid); }
    footer a { color: var(--mid); transition: color 0.15s; }
    footer a:hover { color: var(--text); }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .hero {
        grid-template-columns: 1fr; min-height: auto;
        padding: 6rem 1.5rem 4rem; gap: 3rem;
      }
      .hero-right { display: none; }
      .feat-split, .feat-reversed { grid-template-columns: 1fr; gap: 2.5rem; }
      .feat-reversed .feat-meta { order: 0; }
      .feat-reversed .feat-rows { order: 1; }
      .feat-compact { flex-direction: column; gap: 2rem; }
      .feat-compact .feat-meta { flex: none; }
      .deploy-layout { grid-template-columns: 1fr; gap: 2.5rem; }
      .feat-panel { padding: 1.75rem; }
      .feat-panel .feat-split { grid-template-columns: 1fr; gap: 2rem; }
    }
    @media (max-width: 640px) {
      .container { padding: 0 1.25rem; }
      .nav-inner { padding: 0 1.25rem; }
      .nav-hide { display: none; }
      .section { padding: 4rem 0; }
      .feat-row { grid-template-columns: 1fr; gap: 0.25rem; }
      .feat-tiles { grid-template-columns: 1fr; }
      .feat-tile { border-right: none; border-bottom: 1px solid var(--rule) !important; }
      .feat-tile:last-child { border-bottom: none !important; }
      h1 { font-size: 2.75rem; }
      .section-heading { font-size: 1.75rem; }
      .snippet-tabs { overflow-x: auto; }
      .snippet-tab { white-space: nowrap; }
      .footer-inner { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>

<div class="scroll-progress" id="sp" aria-hidden="true"></div>
<div class="hero-scan" aria-hidden="true"></div>

<nav id="nav">
  <div class="nav-inner">
    <a href="/" class="logo">${LOGO_SVG} Parallax</a>
    <div class="nav-links">
      <a href="#features" class="nav-hide">Features</a>
      <a href="#deploy" class="nav-hide">Deploy</a>
      <a href="#windows" class="nav-hide">Windows</a>
      <a href="${ghUrl}" target="_blank" rel="noopener" class="btn btn-outline">${GITHUB_ICON} GitHub</a>
    </div>
  </div>
</nav>

<div style="border-bottom:1px solid var(--rule)">
  <div class="hero">
    <div class="hero-left">
      <div class="eyebrow">
        <span class="eyebrow-pip"></span>
        Open source
        <span class="eyebrow-sep">·</span>
        No nonsense
        <span class="eyebrow-sep">·</span>
        Self-hosted
      </div>
      <h1>
        <span class="hero-line">Your media library.</span>
        <em class="hero-line"><span class="h1-accent">Unlimited control.</span></em>
      </h1>
      <p class="hero-sub">No pricing. No subscription. No uploads. Process your media, on your device, with your hardware.</p>
      <div class="hero-cta">
        <a href="#deploy" class="btn btn-solid">Deploy now</a>
        <a href="${ghUrl}" target="_blank" rel="noopener" class="btn btn-outline">${GITHUB_ICON} View on GitHub</a>
      </div>
    </div>
    <div class="hero-right">
      <div class="terminal">
        <div class="terminal-bar">
          <div class="t-dots"><span class="r"></span><span class="y"></span><span class="g"></span></div>
          <span class="t-label">docker-compose.yml</span>
        </div>
        <pre><span class="t-k">services</span>:
  <span class="t-k">parallax</span>:
    <span class="t-k">image</span>: <span class="t-v">ghcr.io/raslan/parallax:latest-cuda</span>
    <span class="t-k">ports</span>:
      - <span class="t-v">"7899:7899"</span>
    <span class="t-k">volumes</span>:
      - <span class="t-v">./data:/app/data</span>
      - <span class="t-v">/your/media:/media</span>
    <span class="t-k">restart</span>: <span class="t-v">unless-stopped</span>
    <span class="t-k">deploy</span>:
      <span class="t-c"># NVIDIA GPU</span>
      <span class="t-k">resources</span>:
        <span class="t-k">reservations</span>:
          <span class="t-k">devices</span>:
            - {<span class="t-k">driver</span>: <span class="t-v">nvidia</span>, <span class="t-k">count</span>: <span class="t-v">all</span>,
               <span class="t-k">capabilities</span>: [<span class="t-v">gpu</span>, <span class="t-v">video</span>]}</pre>
      </div>
    </div>
  </div>
</div>

<section class="section" id="features">
  <div class="sect-num" aria-hidden="true">01</div>
  <div class="container">
    <div class="reveal">
      <div class="section-label">Features</div>
      <h2 class="section-heading">No subscriptions. No cloud. No nonsense.</h2>
      <p class="section-sub">Everything the paid tiers don't want you to have: compression, repair, filtering, cleaning, renaming, subtitles, downloads and more; running locally on the hardware you already own.</p>
    </div>
  </div>
</section>

${featureGroupSectionsHtml}

<section class="section" id="deploy">
  <div class="sect-num" aria-hidden="true">07</div>
  <div class="container">
    <div class="deploy-layout">
      <div>
        <div class="reveal">
          <div class="section-label">Deploy</div>
          <h2 class="section-heading">One container. Runs everywhere.</h2>
          <p class="section-sub">Pre-built images for CPU, NVIDIA, and AMD. Pull, run, own your media.</p>
        </div>
        <br>
        <div class="runtime-cards reveal" style="--rd:0.15s">
          ${runtimeCardsHtml}
        </div>
        <br>
        <a href="${ghUrl}#deployment" target="_blank" rel="noopener" class="btn btn-outline reveal" style="--rd:0.25s;margin-top:0.5rem">Full deploy docs →</a>
      </div>
      <div class="reveal" style="--rd:0.1s">
        <div class="deploy-snippet">
          <div class="snippet-tabs">
            <div class="snippet-tab active" onclick="switchTab(this,'nvidia')">NVIDIA</div>
            <div class="snippet-tab" onclick="switchTab(this,'amd')">AMD</div>
            <div class="snippet-tab" onclick="switchTab(this,'cpu')">CPU</div>
          </div>
          <div class="snippet-body active" id="tab-nvidia"><pre><span class="s-c"># NVIDIA — requires nvidia-container-toolkit</span>
<span class="s-k">services</span>:
  <span class="s-k">parallax</span>:
    <span class="s-k">image</span>: <span class="s-v">ghcr.io/raslan/parallax:latest-cuda</span>
    <span class="s-k">ports</span>: [<span class="s-s">"7899:7899"</span>]
    <span class="s-k">volumes</span>:
      - <span class="s-v">./data:/app/data</span>
      - <span class="s-v">/your/media:/media</span>
    <span class="s-k">restart</span>: <span class="s-v">unless-stopped</span>
    <span class="s-k">deploy</span>:
      <span class="s-k">resources</span>:
        <span class="s-k">reservations</span>:
          <span class="s-k">devices</span>:
            - {<span class="s-k">driver</span>: <span class="s-v">nvidia</span>, <span class="s-k">count</span>: <span class="s-v">all</span>, <span class="s-k">capabilities</span>: [<span class="s-v">gpu</span>, <span class="s-v">video</span>]}</pre></div>
          <div class="snippet-body" id="tab-amd"><pre><span class="s-c"># AMD — VA-API via /dev/dri</span>
<span class="s-k">services</span>:
  <span class="s-k">parallax</span>:
    <span class="s-k">image</span>: <span class="s-v">ghcr.io/raslan/parallax:latest-rocm</span>
    <span class="s-k">ports</span>: [<span class="s-s">"7899:7899"</span>]
    <span class="s-k">volumes</span>:
      - <span class="s-v">./data:/app/data</span>
      - <span class="s-v">/your/media:/media</span>
    <span class="s-k">restart</span>: <span class="s-v">unless-stopped</span>
    <span class="s-k">devices</span>:
      - <span class="s-v">/dev/dri:/dev/dri</span>
    <span class="s-k">group_add</span>: [<span class="s-v">video</span>]</pre></div>
          <div class="snippet-body" id="tab-cpu"><pre><span class="s-c"># CPU — no GPU required</span>
<span class="s-k">services</span>:
  <span class="s-k">parallax</span>:
    <span class="s-k">image</span>: <span class="s-v">ghcr.io/raslan/parallax:latest</span>
    <span class="s-k">ports</span>: [<span class="s-s">"7899:7899"</span>]
    <span class="s-k">volumes</span>:
      - <span class="s-v">./data:/app/data</span>
      - <span class="s-v">/your/media:/media</span>
    <span class="s-k">restart</span>: <span class="s-v">unless-stopped</span></pre></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section" id="windows">
  <div class="sect-num" aria-hidden="true">08</div>
  <div class="container">
    <div class="deploy-layout">
      <div>
        <div class="reveal">
          <div class="section-label">Windows</div>
          <h2 class="section-heading">Even on Windows</h2>
          <p class="section-sub"><a href="https://www.docker.com/products/docker-desktop/">Docker Desktop</a> handles the runtime. Same compose file as Linux. No installer wizard, no license key, no trial period.</p>
        </div>
        <br>
        <div class="runtime-cards reveal" style="--rd:0.15s">
          <div class="runtime-card">
            <div class="runtime-label nvidia">NVIDIA</div>
            <code class="runtime-tag">latest-cuda</code>
            <p class="runtime-desc">Install Docker Desktop, then update your NVIDIA GPU driver (521+). WSL 2 includes CUDA support — no separate toolkit required.</p>
          </div>
          <div class="runtime-card">
            <div class="runtime-label amd">AMD</div>
            <code class="runtime-tag">latest</code>
            <p class="runtime-desc">AMD ROCm is not supported under WSL 2. Use the CPU image. ONNX inference runs on CPU; hardware video encoding is unavailable with this configuration unfortunately.</p>
          </div>
          <div class="runtime-card">
            <div class="runtime-label cpu">CPU</div>
            <code class="runtime-tag">latest</code>
            <p class="runtime-desc">Works out of the box with Docker Desktop.</p>
          </div>
        </div>
      </div>
      <div class="reveal" style="--rd:0.1s">
        <div class="deploy-snippet">
          <div class="snippet-tabs">
            <div class="snippet-tab active" onclick="switchTab(this,'win-nvidia')">NVIDIA</div>
            <div class="snippet-tab" onclick="switchTab(this,'win-cpu')">CPU / AMD</div>
          </div>
          <div class="snippet-body active" id="tab-win-nvidia"><pre><span class="s-c"># Windows — Docker Desktop + NVIDIA driver 521+</span>
<span class="s-c"># No NVIDIA Container Toolkit needed on Windows</span>
<span class="s-k">services</span>:
  <span class="s-k">parallax</span>:
    <span class="s-k">image</span>: <span class="s-v">ghcr.io/raslan/parallax:latest-cuda</span>
    <span class="s-k">ports</span>: [<span class="s-s">"7899:7899"</span>]
    <span class="s-k">volumes</span>:
      - <span class="s-v">./data:/app/data</span>
      - <span class="s-v">C:/your/media:/media</span>
    <span class="s-k">restart</span>: <span class="s-v">unless-stopped</span>
    <span class="s-k">deploy</span>:
      <span class="s-k">resources</span>:
        <span class="s-k">reservations</span>:
          <span class="s-k">devices</span>:
            - {<span class="s-k">driver</span>: <span class="s-v">nvidia</span>, <span class="s-k">count</span>: <span class="s-v">all</span>, <span class="s-k">capabilities</span>: [<span class="s-v">gpu</span>, <span class="s-v">video</span>]}</pre></div>
          <div class="snippet-body" id="tab-win-cpu"><pre><span class="s-c"># Windows — Docker Desktop, CPU only</span>
<span class="s-c"># AMD GPU acceleration not supported on Windows/WSL 2</span>
<span class="s-k">services</span>:
  <span class="s-k">parallax</span>:
    <span class="s-k">image</span>: <span class="s-v">ghcr.io/raslan/parallax:latest</span>
    <span class="s-k">ports</span>: [<span class="s-s">"7899:7899"</span>]
    <span class="s-k">volumes</span>:
      - <span class="s-v">./data:/app/data</span>
      - <span class="s-v">C:/your/media:/media</span>
    <span class="s-k">restart</span>: <span class="s-v">unless-stopped</span></pre></div>
        </div>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <div class="footer-inner">
      <a href="/" class="footer-logo">${LOGO_SVG} Parallax</a>
      <p>Open source — <a href="${ghUrl}" target="_blank" rel="noopener">github.com/raslan/parallax</a></p>
    </div>
  </div>
</footer>

<script>
  function switchTab(el, id) {
    el.closest('.deploy-snippet').querySelectorAll('.snippet-tab').forEach(t => t.classList.remove('active'));
    el.closest('.deploy-snippet').querySelectorAll('.snippet-body').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('tab-' + id).classList.add('active');
  }

  const sp = document.getElementById('sp');
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    const s = document.documentElement;
    const pct = s.scrollTop / (s.scrollHeight - s.clientHeight) * 100;
    sp.style.width = pct + '%';
    nav.classList.toggle('scrolled', s.scrollTop > 60);
  }, { passive: true });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -48px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
</script>

</body>
</html>`;

// ── Write output ──────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, "../dist");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");

const ogSrc = path.join(__dirname, "../og-image.png");
if (fs.existsSync(ogSrc)) {
  fs.copyFileSync(ogSrc, path.join(outDir, "og-image.png"));
  console.log("Copied og-image.png to dist/");
}

console.log("Built dist/index.html");
