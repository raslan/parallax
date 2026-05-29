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

// ── Feature icons ─────────────────────────────────────────────────────────────

const groupIcons = {
  Videos: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
  Images: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  AI: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/></svg>`,
  General: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

// ── Build HTML ────────────────────────────────────────────────────────────────

const featureCardsHtml = featureGroups
  .map(
    ({ title, items }) => `
    <div class="feature-group">
      <div class="group-header">
        <span class="group-icon">${groupIcons[title] || groupIcons.General}</span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <ul>
        ${items
          .map(
            ({ name, desc }) =>
              `<li><strong>${escapeHtml(name)}</strong><span>${mdInline(desc)}</span></li>`
          )
          .join("\n        ")}
      </ul>
    </div>`
  )
  .join("\n");

const runtimeRowsHtml = runtimeRows
  .map(
    ({ tag, desc }) =>
      `<tr><td><code>${escapeHtml(tag)}</code></td><td>${escapeHtml(desc)}</td></tr>`
  )
  .join("\n          ");

const ghUrl = "https://github.com/raslan/parallax";

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Parallax — Self-hosted media manager</title>
  <meta name="description" content="A self-hosted video and image library manager with transcoding, AI scanning, duplicate detection, and media identification. Runs in Docker." />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #09090b;
      --bg-card:   #111113;
      --bg-card2:  #18181b;
      --border:    #27272a;
      --accent:    #8b5cf6;
      --accent-lo: #8b5cf620;
      --accent-hi: #a78bfa;
      --text:      #fafafa;
      --muted:     #a1a1aa;
      --code-bg:   #1c1c1f;
      --radius:    0.5rem;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      min-height: 100vh;
    }

    a { color: var(--accent-hi); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 0.25rem;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 0.85em;
      padding: 0.15em 0.4em;
    }
    strong { color: var(--text); font-weight: 600; }

    /* ── Layout ── */
    .container { max-width: 1100px; margin: 0 auto; padding: 0 1.5rem; }

    /* ── Nav ── */
    nav {
      border-bottom: 1px solid var(--border);
      padding: 1rem 0;
      position: sticky;
      top: 0;
      background: #09090bcc;
      backdrop-filter: blur(12px);
      z-index: 10;
    }
    nav .inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-weight: 700;
      font-size: 1.1rem;
      color: var(--text);
      text-decoration: none;
    }
    .logo-mark {
      width: 32px; height: 32px;
    }
    nav .links { display: flex; gap: 1.5rem; align-items: center; }
    nav .links a { color: var(--muted); font-size: 0.9rem; }
    nav .links a:hover { color: var(--text); text-decoration: none; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 1rem;
      border-radius: var(--radius);
      font-size: 0.875rem;
      font-weight: 500;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; text-decoration: none; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-ghost {
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
    }
    .btn-ghost:hover { color: var(--text); }

    /* ── Hero ── */
    .hero {
      padding: 6rem 0 4rem;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .hero::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse 80% 50% at 50% 0%, #8b5cf630 0%, transparent 70%);
      pointer-events: none;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: var(--accent-lo);
      border: 1px solid #8b5cf640;
      border-radius: 99px;
      color: var(--accent-hi);
      font-size: 0.8rem;
      font-weight: 500;
      padding: 0.3rem 0.8rem;
      margin-bottom: 1.5rem;
    }
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
    h1 {
      font-size: clamp(2.2rem, 6vw, 3.8rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin-bottom: 1rem;
    }
    h1 span { color: var(--accent-hi); }
    .hero-sub {
      color: var(--muted);
      font-size: clamp(1rem, 2.5vw, 1.2rem);
      max-width: 600px;
      margin: 0 auto 2.5rem;
    }
    .hero-actions { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }

    /* ── Quick start ── */
    .quickstart {
      margin: 3rem auto;
      max-width: 560px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .quickstart-header {
      padding: 0.6rem 1rem;
      background: var(--bg-card2);
      border-bottom: 1px solid var(--border);
      font-size: 0.75rem;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .quickstart-header .dots { display: flex; gap: 0.35rem; }
    .quickstart-header .dots span {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--border);
    }
    .quickstart pre {
      padding: 1rem 1.25rem;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 0.85rem;
      color: #e4e4e7;
      overflow-x: auto;
      background: none;
      border: none;
    }
    .quickstart pre .prompt { color: var(--accent); user-select: none; }
    .quickstart pre .comment { color: var(--muted); }

    /* ── Runtime tags ── */
    .runtime-section {
      margin: 4rem 0;
      text-align: center;
    }
    .runtime-section h2 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    .runtime-section p { color: var(--muted); margin-bottom: 1.5rem; }
    .runtime-table {
      display: inline-table;
      border-collapse: collapse;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      font-size: 0.875rem;
      text-align: left;
    }
    .runtime-table th {
      background: var(--bg-card2);
      padding: 0.6rem 1.25rem;
      color: var(--muted);
      font-weight: 500;
      border-bottom: 1px solid var(--border);
    }
    .runtime-table td {
      padding: 0.7rem 1.25rem;
      border-bottom: 1px solid var(--border);
    }
    .runtime-table tr:last-child td { border-bottom: none; }
    .runtime-table tr:hover td { background: var(--bg-card); }

    /* ── Features ── */
    .features-section { padding: 4rem 0; }
    .features-section > .container > h2 {
      font-size: 1.8rem;
      font-weight: 700;
      text-align: center;
      margin-bottom: 0.5rem;
    }
    .features-section > .container > p {
      text-align: center;
      color: var(--muted);
      margin-bottom: 3rem;
    }
    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.25rem;
    }
    .feature-group {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      transition: border-color 0.2s;
    }
    .feature-group:hover { border-color: #8b5cf650; }
    .group-header {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 1rem;
    }
    .group-icon { color: var(--accent-hi); flex-shrink: 0; }
    .group-header h3 { font-size: 1rem; font-weight: 600; }
    .feature-group ul { list-style: none; display: flex; flex-direction: column; gap: 0.75rem; }
    .feature-group li {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      padding-left: 0.85rem;
      border-left: 2px solid var(--border);
      font-size: 0.875rem;
    }
    .feature-group li strong { font-size: 0.875rem; color: var(--text); }
    .feature-group li span { color: var(--muted); line-height: 1.4; }

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 2rem 0;
      text-align: center;
      color: var(--muted);
      font-size: 0.85rem;
    }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    @media (max-width: 600px) {
      .hero { padding: 4rem 0 2.5rem; }
      nav .links .hide-mobile { display: none; }
    }
  </style>
</head>
<body>

<nav>
  <div class="inner">
    <a href="/" class="logo">
      <svg class="logo-mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <text x="1" y="16" font-family="monospace" font-size="15" font-weight="700" fill="#8b5cf6">P</text>
        <circle cx="17" cy="4" r="1.2" fill="#8b5cf6"/>
        <line x1="17" y1="1.3" x2="17" y2="6.7" stroke="#8b5cf6" stroke-width="0.7" opacity="0.55"/>
        <line x1="14.3" y1="4" x2="19.7" y2="4" stroke="#8b5cf6" stroke-width="0.7" opacity="0.55"/>
      </svg>
      Parallax
    </a>
    <div class="links">
      <a href="#features" class="hide-mobile">Features</a>
      <a href="#deploy" class="hide-mobile">Deploy</a>
      <a href="${ghUrl}" target="_blank" rel="noopener" class="btn btn-ghost">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
        GitHub
      </a>
      <a href="${ghUrl}/releases" target="_blank" rel="noopener" class="btn btn-primary">Get Parallax</a>
    </div>
  </div>
</nav>

<section class="hero">
  <div class="container">
    <div class="badge"><span class="badge-dot"></span>Self-hosted · Docker · Open source</div>
    <h1>Your media library,<br><span>under your control</span></h1>
    <p class="hero-sub">Parallax is a self-hosted video and image manager with GPU-accelerated AI scanning, transcoding, duplicate detection, and media identification.</p>
    <div class="hero-actions">
      <a href="#deploy" class="btn btn-primary">Deploy now</a>
      <a href="${ghUrl}" target="_blank" rel="noopener" class="btn btn-ghost">View on GitHub</a>
    </div>

    <div class="quickstart">
      <div class="quickstart-header">
        <div class="dots"><span></span><span></span><span></span></div>
        docker-compose.yml
      </div>
      <pre><span class="comment"># NVIDIA GPU</span>
<span class="prompt">$</span> docker compose up -d

<span class="comment"># Pull the latest CUDA image</span>
image: ghcr.io/raslan/parallax:latest-cuda</pre>
    </div>
  </div>
</section>

<section class="runtime-section" id="deploy">
  <div class="container">
    <h2>Pick your runtime</h2>
    <p>Pre-built images for every hardware target — no compilation needed.</p>
    <table class="runtime-table">
      <thead><tr><th>Image tag</th><th>Hardware</th></tr></thead>
      <tbody>
        ${runtimeRowsHtml}
      </tbody>
    </table>
    <br><br>
    <a href="${ghUrl}#deployment" target="_blank" rel="noopener" class="btn btn-ghost">Full deploy docs &rarr;</a>
  </div>
</section>

<section class="features-section" id="features">
  <div class="container">
    <h2>Everything you need</h2>
    <p>One container. No cloud. Your data stays yours.</p>
    <div class="features-grid">
      ${featureCardsHtml}
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <p>Parallax is open source — <a href="${ghUrl}" target="_blank" rel="noopener">github.com/raslan/parallax</a></p>
  </div>
</footer>

</body>
</html>`;

// ── Write output ──────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, "../dist");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
console.log("Built dist/index.html");
