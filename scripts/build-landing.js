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

// Split on ## headings — avoids multiline $ gotcha in JS regex
function getSection(heading) {
  const parts = README.split(/^## /m);
  const part = parts.find((p) => p.startsWith(heading));
  return part ? part.slice(heading.length).trim() : "";
}

// Parse feature groups (### subsections with bullet lists)
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

// Parse tag table from Deployment section — match all ghcr.io rows anywhere in section
function parseRuntimeTable() {
  const section = getSection("Deployment");
  const rows = [...section.matchAll(/\| `(ghcr\.io[^`]+)` \| ([^|]+) \|/g)].map(
    ([, tag, desc]) => ({ tag: tag.trim(), desc: desc.trim() })
  );
  return rows;
}

const featureGroups = parseFeatureGroups();
const runtimeRows = parseRuntimeTable();

// ── Build HTML parts ──────────────────────────────────────────────────────────

// Flatten all features into a single list for a clean grid
const allFeatures = featureGroups.flatMap((g) => g.items);

const featuresHtml = allFeatures
  .map(
    ({ name, desc }) => `
    <div class="feat-item">
      <strong>${escapeHtml(name)}</strong>
      <span>${mdInline(desc)}</span>
    </div>`
  )
  .join("\n");

const runtimeLabels = { cpu: "CPU", cuda: "NVIDIA", rocm: "AMD" };
const runtimeDescs = {
  cpu: "No GPU required. AI inference runs on CPU.",
  cuda: "ONNX CUDA backend + NVENC hardware transcoding.",
  rocm: "ONNX ROCm backend + VA-API hardware transcoding.",
};

const runtimeColorClass = { cpu: "cpu", cuda: "nvidia", rocm: "amd" };

const runtimeCardsHtml = runtimeRows
  .map(({ tag, desc }) => {
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

const GITHUB_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>`;

const LOGO_SVG = `<svg class="logo-mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <text x="1" y="16" font-family="monospace" font-size="15" font-weight="700" fill="#0d9488">P</text>
        <circle cx="17" cy="4" r="1.2" fill="#0d9488"/>
        <line x1="17" y1="1.3" x2="17" y2="6.7" stroke="#0d9488" stroke-width="0.7" opacity="0.55"/>
        <line x1="14.3" y1="4" x2="19.7" y2="4" stroke="#0d9488" stroke-width="0.7" opacity="0.55"/>
      </svg>`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Parallax — Self-hosted media manager</title>
  <meta name="description" content="A self-hosted video and image library manager with transcoding, AI scanning, duplicate detection, and media identification. Runs in Docker." />

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600;1,700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />

  <!-- Favicon -->
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Ctext x='1' y='16' font-family='monospace' font-size='15' font-weight='700' fill='%230d9488'%3EP%3C/text%3E%3Ccircle cx='17' cy='4' r='1.2' fill='%230d9488'/%3E%3Cline x1='17' y1='1.3' x2='17' y2='6.7' stroke='%230d9488' stroke-width='0.7' opacity='0.55'/%3E%3Cline x1='14.3' y1='4' x2='19.7' y2='4' stroke='%230d9488' stroke-width='0.7' opacity='0.55'/%3E%3C/svg%3E" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Parallax" />
  <meta property="og:title" content="Parallax — Self-hosted media manager" />
  <meta property="og:description" content="Scan, transcode, deduplicate, and search your video and image libraries with GPU-accelerated AI — on hardware you own." />
  <meta property="og:image" content="https://parallax.raslan.dev/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="https://parallax.raslan.dev" />

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Parallax — Self-hosted media manager" />
  <meta name="twitter:description" content="Scan, transcode, deduplicate, and search your video and image libraries with GPU-accelerated AI — on hardware you own." />
  <meta name="twitter:image" content="https://parallax.raslan.dev/og-image.png" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #070c0b;
      --bg-card:   #0c1210;
      --bg-card2:  #101916;
      --border:    #192520;
      --border-hi: #243530;
      --accent:    #0d9488;
      --accent-hi: #2dd4bf;
      --accent-lo: rgba(13,148,136,0.1);
      --cyan:      #0891b2;
      --text:      #eef7f5;
      --muted:     #6b7f7c;
      --radius:    0.4rem;
      --serif:     "Playfair Display", Georgia, "Times New Roman", serif;
      --sans:      "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --mono:      "SF Mono", "Fira Code", "Cascadia Code", monospace;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--accent-hi); text-decoration: none; }
    a:hover { color: var(--text); }
    code {
      font-family: var(--mono);
      font-size: 0.8em;
    }

    .container { max-width: 1080px; margin: 0 auto; padding: 0 2rem; }

    /* ── Nav ── */
    nav {
      border-bottom: 1px solid var(--border);
      padding: 0.875rem 0;
      position: sticky;
      top: 0;
      background: rgba(7,12,11,0.88);
      backdrop-filter: blur(16px);
      z-index: 10;
    }
    .nav-inner {
      max-width: 1080px;
      margin: 0 auto;
      padding: 0 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-family: var(--serif);
      font-weight: 700;
      font-size: 1rem;
      color: var(--text);
      letter-spacing: 0.01em;
    }
    .logo-mark { width: 28px; height: 28px; }
    .nav-links { display: flex; align-items: center; gap: 0.25rem; }
    .nav-links a {
      color: var(--muted);
      font-size: 0.875rem;
      padding: 0.35rem 0.75rem;
      border-radius: var(--radius);
      transition: color 0.15s;
    }
    .nav-links a:hover { color: var(--text); }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.4rem 0.875rem;
      border-radius: var(--radius);
      font-size: 0.8125rem;
      font-weight: 500;
      transition: opacity 0.15s, background 0.15s;
      white-space: nowrap;
    }
    .btn-outline {
      color: var(--muted);
      border: 1px solid var(--border);
      background: transparent;
    }
    .btn-outline:hover { color: var(--text); border-color: #2e4440; }
    .btn-solid { background: linear-gradient(135deg, var(--accent) 0%, var(--cyan) 100%); color: #fff; }
    .btn-solid:hover { opacity: 0.88; color: #fff; }

    /* ── Hero ── */
    .hero {
      padding: 7rem 0 5rem;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .hero::before {
      content: "";
      position: absolute;
      top: -80px; left: 50%;
      transform: translateX(-50%);
      width: 1000px; height: 500px;
      background:
        radial-gradient(ellipse 60% 55% at 40% 40%, rgba(13,148,136,0.18) 0%, transparent 65%),
        radial-gradient(ellipse 50% 45% at 65% 30%, rgba(8,145,178,0.13) 0%, transparent 60%);
      pointer-events: none;
    }
    .hero::after {
      content: "";
      position: absolute;
      inset: 0;
      background-image: radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px);
      background-size: 28px 28px;
      pointer-events: none;
      mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, black 0%, transparent 75%);
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--muted);
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-weight: 500;
      margin-bottom: 1.75rem;
    }
    .eyebrow-dot {
      width: 5px; height: 5px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent), var(--cyan));
    }
    .eyebrow span { color: var(--border-hi); }
    h1 {
      font-family: var(--serif);
      font-size: clamp(2.6rem, 6vw, 4.2rem);
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.1;
      margin-bottom: 1.25rem;
      color: var(--text);
    }
    h1 em {
      font-style: italic;
      background: linear-gradient(135deg, #2dd4bf 0%, #22d3ee 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero-sub {
      color: var(--muted);
      font-size: 1.0625rem;
      max-width: 520px;
      margin: 0 auto 2.5rem;
      line-height: 1.65;
    }
    .hero-cta {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 4rem;
    }

    /* ── Terminal ── */
    .terminal {
      margin: 0 auto;
      max-width: 520px;
      border: 1px solid var(--border);
      border-radius: 0.6rem;
      overflow: hidden;
      background: var(--bg-card);
      text-align: left;
      box-shadow: 0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(13,148,136,0.06);
    }
    .terminal-bar {
      background: var(--bg-card2);
      border-bottom: 1px solid var(--border);
      padding: 0.6rem 1rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .t-dots { display: flex; gap: 0.4rem; }
    .t-dots span { width: 9px; height: 9px; border-radius: 50%; }
    .t-dots .r { background: #ff5f57; }
    .t-dots .y { background: #febc2e; }
    .t-dots .g { background: #28c840; }
    .t-label { font-size: 0.72rem; color: var(--muted); font-family: var(--mono); }
    .terminal pre {
      padding: 1.25rem 1.5rem;
      font-family: var(--mono);
      font-size: 0.8125rem;
      line-height: 1.7;
      color: #cfe8e4;
      overflow-x: auto;
    }
    .t-comment { color: #334d49; }
    .t-key { color: #5eead4; }
    .t-val { color: #86efac; }
    .t-prompt { color: #334d49; user-select: none; }

    /* ── Section shared ── */
    .section { padding: 6rem 0; border-top: 1px solid var(--border); }
    .section-label {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      background: linear-gradient(90deg, var(--accent-hi), #22d3ee);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.75rem;
      display: inline-block;
    }
    .section-heading {
      font-family: var(--serif);
      font-size: clamp(1.7rem, 3vw, 2.4rem);
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.18;
      margin-bottom: 1rem;
    }
    .section-sub {
      color: var(--muted);
      font-size: 0.9375rem;
      max-width: 480px;
      line-height: 1.6;
    }

    /* ── Features ── */
    .features-layout {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 4rem;
      align-items: start;
    }
    .feat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .feat-item {
      padding: 1.1rem 1.25rem;
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      transition: background 0.15s;
    }
    .feat-item:hover { background: rgba(13,148,136,0.05); }
    .feat-item:hover strong { color: var(--accent-hi); }
    .feat-item:nth-child(2n) { border-right: none; }
    .feat-item strong {
      display: block;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 0.2rem;
    }
    .feat-item span {
      font-size: 0.775rem;
      color: var(--muted);
      line-height: 1.45;
    }
    .feat-item span code {
      background: rgba(255,255,255,0.05);
      border-radius: 0.2rem;
      padding: 0.05em 0.35em;
      font-size: 0.75em;
      color: #8ab8b2;
    }

    /* ── Deploy ── */
    .deploy-layout {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 4rem;
      align-items: start;
    }
    .runtime-cards {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .runtime-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      display: grid;
      grid-template-columns: 3.5rem 1fr;
      grid-template-rows: auto auto;
      gap: 0.15rem 1rem;
      align-items: start;
      transition: border-color 0.15s, background 0.15s;
    }
    .runtime-card:hover { border-color: #2e4440; background: var(--bg-card); }
    .runtime-label {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding-top: 0.1rem;
      grid-row: 1;
    }
    .runtime-label.nvidia { color: #4ade80; }
    .runtime-label.amd    { color: #fb923c; }
    .runtime-label.cpu    { color: var(--muted); }
    .runtime-tag {
      font-family: var(--mono);
      font-size: 0.775rem;
      color: #cfe8e4;
      grid-column: 2;
      grid-row: 1;
    }
    .runtime-desc {
      font-size: 0.775rem;
      color: var(--muted);
      grid-column: 2;
      grid-row: 2;
      line-height: 1.4;
    }
    .deploy-snippet {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--bg-card);
    }
    .snippet-tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      background: var(--bg-card2);
    }
    .snippet-tab {
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      color: var(--muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      user-select: none;
      transition: color 0.15s;
    }
    .snippet-tab.active { color: var(--text); border-bottom-color: var(--accent); }
    .snippet-body { display: none; }
    .snippet-body.active { display: block; }
    .snippet-body pre {
      padding: 1.25rem 1.5rem;
      font-family: var(--mono);
      font-size: 0.8rem;
      line-height: 1.7;
      color: #cfe8e4;
      overflow-x: auto;
    }
    .s-comment { color: #334d49; }
    .s-key { color: #5eead4; }
    .s-val { color: #86efac; }
    .s-str { color: #fbbf24; }

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 2.5rem 0;
    }
    .footer-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .footer-logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-family: var(--serif);
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--text);
    }
    .footer-logo svg { width: 22px; height: 22px; }
    footer p { font-size: 0.8rem; color: var(--muted); }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    @media (max-width: 768px) {
      .features-layout, .deploy-layout { grid-template-columns: 1fr; gap: 2.5rem; }
      .feat-grid { grid-template-columns: 1fr; }
      .feat-item { border-right: none; }
      h1 { font-size: 2.4rem; }
      .hero { padding: 5rem 0 3.5rem; }
      .section { padding: 4rem 0; }
      .nav-hide { display: none; }
      .footer-inner { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>

<nav>
  <div class="nav-inner">
    <a href="/" class="logo">
      ${LOGO_SVG}
      Parallax
    </a>
    <div class="nav-links">
      <a href="#features" class="nav-hide">Features</a>
      <a href="#deploy" class="nav-hide">Deploy</a>
      <a href="${ghUrl}" target="_blank" rel="noopener" class="btn btn-outline">${GITHUB_ICON} GitHub</a>
    </div>
  </div>
</nav>

<section class="hero">
  <div class="container">
    <div class="eyebrow">
      <span class="eyebrow-dot"></span>
      Open source
      <span>·</span>
      Self-hosted
      <span>·</span>
      Docker
    </div>
    <h1>Media management,<br><em>without the cloud</em></h1>
    <p class="hero-sub">Scan, transcode, deduplicate, and search your video and image libraries — with GPU-accelerated AI — on hardware you own.</p>
    <div class="hero-cta">
      <a href="#deploy" class="btn btn-solid">Deploy now</a>
      <a href="${ghUrl}" target="_blank" rel="noopener" class="btn btn-outline">${GITHUB_ICON} View on GitHub</a>
    </div>

    <div class="terminal">
      <div class="terminal-bar">
        <div class="t-dots"><span class="r"></span><span class="y"></span><span class="g"></span></div>
        <span class="t-label">docker-compose.yml</span>
      </div>
      <pre><span class="t-key">services</span>:
  <span class="t-key">parallax</span>:
    <span class="t-key">image</span>: <span class="t-val">ghcr.io/raslan/parallax:latest-cuda</span>
    <span class="t-key">ports</span>:
      - <span class="t-val">"7899:7899"</span>
    <span class="t-key">volumes</span>:
      - <span class="t-val">./data:/app/data</span>
      - <span class="t-val">/your/media:/media</span>
    <span class="t-key">restart</span>: <span class="t-val">unless-stopped</span>
    <span class="t-key">deploy</span>:
      <span class="t-comment"># NVIDIA GPU</span>
      <span class="t-key">resources</span>:
        <span class="t-key">reservations</span>:
          <span class="t-key">devices</span>: [{<span class="t-key">driver</span>: <span class="t-val">nvidia</span>, <span class="t-key">count</span>: <span class="t-val">all</span>, <span class="t-key">capabilities</span>: [<span class="t-val">gpu</span>, <span class="t-val">video</span>]}]</pre>
    </div>
  </div>
</section>

<section class="section" id="features">
  <div class="container">
    <div class="features-layout">
      <div>
        <div class="section-label">Features</div>
        <h2 class="section-heading">Built for serious libraries</h2>
        <p class="section-sub">Video and image management with AI scanning, hardware transcoding, and duplicate detection — all in one container.</p>
      </div>
      <div class="feat-grid">
        ${featuresHtml}
      </div>
    </div>
  </div>
</section>

<section class="section" id="deploy">
  <div class="container">
    <div class="deploy-layout">
      <div>
        <div class="section-label">Deploy</div>
        <h2 class="section-heading">One command, any hardware</h2>
        <p class="section-sub">Pre-built images for CPU, NVIDIA, and AMD. No compilation. Pull and run.</p>
        <br>
        <div class="runtime-cards">
          ${runtimeCardsHtml}
        </div>
        <br>
        <a href="${ghUrl}#deployment" target="_blank" rel="noopener" class="btn btn-outline" style="margin-top:0.5rem">Full deploy docs →</a>
      </div>
      <div>
        <div class="deploy-snippet">
          <div class="snippet-tabs">
            <div class="snippet-tab active" onclick="switchTab(this,'nvidia')">NVIDIA</div>
            <div class="snippet-tab" onclick="switchTab(this,'amd')">AMD</div>
            <div class="snippet-tab" onclick="switchTab(this,'cpu')">CPU</div>
          </div>
          <div class="snippet-body active" id="tab-nvidia"><pre><span class="s-comment"># NVIDIA — requires nvidia-container-toolkit</span>
<span class="s-key">services</span>:
  <span class="s-key">parallax</span>:
    <span class="s-key">image</span>: <span class="s-val">ghcr.io/raslan/parallax:latest-cuda</span>
    <span class="s-key">ports</span>: [<span class="s-str">"7899:7899"</span>]
    <span class="s-key">volumes</span>:
      - <span class="s-val">./data:/app/data</span>
      - <span class="s-val">/your/media:/media</span>
    <span class="s-key">restart</span>: <span class="s-val">unless-stopped</span>
    <span class="s-key">deploy</span>:
      <span class="s-key">resources</span>:
        <span class="s-key">reservations</span>:
          <span class="s-key">devices</span>:
            - {<span class="s-key">driver</span>: <span class="s-val">nvidia</span>, <span class="s-key">count</span>: <span class="s-val">all</span>, <span class="s-key">capabilities</span>: [<span class="s-val">gpu</span>, <span class="s-val">video</span>]}</pre></div>
          <div class="snippet-body" id="tab-amd"><pre><span class="s-comment"># AMD — VA-API via /dev/dri</span>
<span class="s-key">services</span>:
  <span class="s-key">parallax</span>:
    <span class="s-key">image</span>: <span class="s-val">ghcr.io/raslan/parallax:latest-rocm</span>
    <span class="s-key">ports</span>: [<span class="s-str">"7899:7899"</span>]
    <span class="s-key">volumes</span>:
      - <span class="s-val">./data:/app/data</span>
      - <span class="s-val">/your/media:/media</span>
    <span class="s-key">restart</span>: <span class="s-val">unless-stopped</span>
    <span class="s-key">devices</span>:
      - <span class="s-val">/dev/dri:/dev/dri</span>
    <span class="s-key">group_add</span>: [<span class="s-val">video</span>]</pre></div>
          <div class="snippet-body" id="tab-cpu"><pre><span class="s-comment"># CPU — no GPU required</span>
<span class="s-key">services</span>:
  <span class="s-key">parallax</span>:
    <span class="s-key">image</span>: <span class="s-val">ghcr.io/raslan/parallax:latest</span>
    <span class="s-key">ports</span>: [<span class="s-str">"7899:7899"</span>]
    <span class="s-key">volumes</span>:
      - <span class="s-val">./data:/app/data</span>
      - <span class="s-val">/your/media:/media</span>
    <span class="s-key">restart</span>: <span class="s-val">unless-stopped</span></pre></div>
        </div>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <div class="footer-inner">
      <a href="/" class="footer-logo">
        ${LOGO_SVG}
        Parallax
      </a>
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
