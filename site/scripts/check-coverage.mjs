// Coverage and forbidden-terms checks for the public site.
//
//   node scripts/check-coverage.mjs           everything, including the built output in out/ (run `npm run build` first)
//   node scripts/check-coverage.mjs --quick   source-only checks (no build needed); used by the pre-commit hook
//
// Checks:
//   1. Every app route in the nav (frontend/src/components/layout/nav-config.ts) is covered by a docs page,
//      and every page named in ROUTE_DOCS exists.
//   2. Every <Shot id> in the docs has a manifest entry, and every manifest asset exists on disk.
//   3. Backend routers <-> API reference: the committed OpenAPI file matches the number of routes in
//      backend/app/api, every operation is tagged, and every tag has a generated page.
//   4. Forbidden terms (yt-dlp, yt_dlp, youtube-dl, gallery-dl, gallery_dl) appear only on the pages listed in
//      NAMED_PAGES, and every such page is disallowed in robots.txt. The landing route also forbids
//      nudenet, downloads and galleries.
//
// Failures exit 1. Warnings (unused shots, pages without a shot) are printed but do not fail.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..");
const repo = path.resolve(site, "..");
const quick = process.argv.includes("--quick");

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const read = (p) => readFileSync(p, "utf8");
const rel = (p) => path.relative(site, p);

function walk(dir, filter = () => true) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Config

/** App route (from the nav) -> the docs page(s) that cover it, relative to content/docs, no extension.
 *  Twin pages (image/audio versions of a video page) are covered by a callout on the video page. */
const ROUTE_DOCS = {
  "/libraries": "general-concepts/libraries",
  "/image-libraries": "general-concepts/libraries",
  "/audio-libraries": "general-concepts/libraries",
  "/files": "features/files",
  "/audio-files": "features/files",
  "/images": "features/files",
  "/compress": "features/compress",
  "/audio-compress": "features/compress",
  "/toolbox": "features/toolbox",
  "/audio-toolbox": "features/toolbox",
  "/splice": "features/splice",
  "/duplicates": "features/duplicates",
  "/image-duplicates": "features/duplicates",
  "/audio-duplicates": "features/duplicates",
  "/cleanup": "features/cleanup",
  "/audio-cleanup": "features/cleanup",
  "/originals": "features/originals",
  "/audio-originals": "features/originals",
  "/image-quarantined": "features/originals",
  "/content-review": "features/content-review",
  "/image-upscale": "features/image-upscale",
  "/organize": "tools/organize",
  "/identify": "tools/identify",
  "/subtitles": "tools/subtitles",
  "/downloads": "tools/downloads",
  "/galleries": "tools/galleries",
};

/** The only places the two download tools may be named (all kept out of crawlers by robots.txt). Each entry is a
 *  URL path prefix and the source files that produce it. */
const NAMED_PAGES = [
  {
    url: "/docs/tools/downloads",
    source: ["content/docs/tools/downloads.mdx"],
  },
  {
    url: "/docs/tools/galleries",
    source: ["content/docs/tools/galleries.mdx"],
  },
  { url: "/docs/api", source: ["content/docs/api", "openapi/parallax.json"] },
  {
    url: "/docs/acknowledgements",
    source: ["content/docs/acknowledgements.mdx", "lib/credits.generated.json"],
  },
];
/** Source files that may mention the tools without being pages (their comments explain the rule). */
const SOURCE_EXEMPT = ["app/robots.ts"];

const STRICT = /yt-dlp|yt_dlp|youtube-dl|gallery-dl|gallery_dl/i;
const LANDING_EXTRA = /nudenet|downloads|galleries/i;

// ---------------------------------------------------------------------------------------------
// 1. Nav routes <-> docs pages

const navSource = read(path.join(repo, "frontend/src/components/layout/nav-config.ts"));
const navRoutes = [...new Set([...navSource.matchAll(/\bto:\s*"(\/[^"]*)"/g)].map((m) => m[1]))];
const docsDir = path.join(site, "content/docs");

for (const route of navRoutes) {
  const page = ROUTE_DOCS[route];
  if (!page) fail(`nav route ${route} has no docs page in ROUTE_DOCS (scripts/check-coverage.mjs)`);
}
for (const [route, page] of Object.entries(ROUTE_DOCS)) {
  if (!navRoutes.includes(route)) fail(`ROUTE_DOCS lists ${route}, which is no longer in the nav`);
  if (!existsSync(path.join(docsDir, `${page}.mdx`)))
    fail(`${route}: docs page content/docs/${page}.mdx does not exist`);
}

// ---------------------------------------------------------------------------------------------
// 2. Docs pages <-> shots

const manifest = JSON.parse(read(path.join(site, "lib/media-manifest.json")));
const usedShots = new Set();
const mdxFiles = walk(docsDir, (f) => f.endsWith(".mdx"));
const pagesWithShots = new Set();
for (const file of mdxFiles) {
  for (const m of read(file).matchAll(/<Shot\s+id="([^"]+)"/g)) {
    usedShots.add(m[1]);
    pagesWithShots.add(path.relative(docsDir, file).replace(/\.mdx$/, ""));
    if (!manifest[m[1]])
      fail(`${rel(file)}: <Shot id="${m[1]}" /> is not in lib/media-manifest.json`);
  }
}
for (const [id, entry] of Object.entries(manifest)) {
  for (const key of ["src", "poster"]) {
    if (entry[key] && !existsSync(path.join(site, "public/media", entry[key]))) {
      fail(`manifest ${id}: public/media/${entry[key]} is missing`);
    }
  }
  if (!usedShots.has(id) && !id.startsWith("landing/"))
    warn(`shot ${id} is in the manifest but no page uses it`);
}
// Landing shots are filmed once per theme on the colour strip: each one needs a take for every theme, or that
// theme silently shows the default look.
const themeIds = [
  ...read(path.join(site, "lib/themes.generated.ts")).matchAll(/"id": "([^"]+)"/g),
].map((m) => m[1]);
const landingBases = new Set(
  Object.keys(manifest)
    .filter((id) => id.startsWith("landing/"))
    .map((id) => manifest[id].baseId ?? id),
);
for (const base of landingBases) {
  for (const t of themeIds) {
    const id = t === themeIds[0] ? base : `${base}.${t}`;
    if (!manifest[id])
      fail(
        `landing shot ${base} has no take for the "${t}" theme (${id}); run npm run capture -- --only ${base}`,
      );
  }
}
// The docs home page lists every feature (lib/features.ts). Each user-facing page has to be in that list, and
// each entry has to point at a page that exists.
{
  const featuresSource = read(path.join(site, "lib/features.ts"));
  const listed = new Set([...featuresSource.matchAll(/href: "(\/docs\/[^"]+)"/g)].map((m) => m[1]));
  const userFacing = mdxFiles
    .map((f) => path.relative(docsDir, f).replace(/\.mdx$/, ""))
    .filter((p) => /^(features|general-concepts|tools)\//.test(p) && p !== "tools/index");
  for (const p of userFacing) {
    if (!listed.has(`/docs/${p}`))
      fail(`docs page ${p} is not in lib/features.ts, so the docs home page does not list it`);
  }
  const existing = new Set(
    mdxFiles.map((f) => `/docs/${path.relative(docsDir, f).replace(/\.mdx$/, "")}`),
  );
  for (const href of listed) {
    if (!existing.has(href)) fail(`lib/features.ts links to ${href}, which is not a docs page`);
  }
  // The docs home page writes each group's heading itself (so it appears in the table of contents).
  const intro = read(path.join(docsDir, "index.mdx"));
  for (const m of featuresSource.matchAll(/id: "([a-z-]+)",\s*title: "([^"]+)",\s*features:/g)) {
    if (!intro.includes(`<FeatureGroup id="${m[1]}" />`))
      fail(
        `content/docs/index.mdx does not show the "${m[2]}" group (<FeatureGroup id="${m[1]}" />)`,
      );
    if (!new RegExp(`^### ${m[2]}$`, "m").test(intro))
      fail(`content/docs/index.mdx has no "### ${m[2]}" heading for its group`);
  }
}
for (const page of new Set(Object.values(ROUTE_DOCS))) {
  if (!pagesWithShots.has(page)) warn(`docs page ${page} has no screenshot or clip`);
}

// ---------------------------------------------------------------------------------------------
// 3. Backend routers <-> API reference

const spec = JSON.parse(read(path.join(site, "openapi/parallax.json")));
const METHODS = ["get", "post", "put", "patch", "delete"];
const operations = Object.entries(spec.paths).flatMap(([p, item]) =>
  METHODS.filter((m) => item[m]).map((m) => ({
    path: p,
    method: m,
    op: item[m],
  })),
);
const apiDir = path.join(repo, "backend/app/api");
let decorators = 0;
for (const file of walk(apiDir, (f) => f.endsWith(".py"))) {
  decorators += (read(file).match(/^@router\.(get|post|put|patch|delete|api_route)\(/gm) ?? [])
    .length;
}
if (decorators !== operations.length) {
  fail(
    `backend/app/api has ${decorators} routes but openapi/parallax.json has ${operations.length} operations: ` +
      `run npm run gen-openapi`,
  );
}
for (const { path: p, method, op } of operations) {
  if (!op.tags?.length)
    fail(`${method.toUpperCase()} ${p} has no tag, so it would have no API page`);
}
const tags = [...new Set(operations.flatMap(({ op }) => op.tags ?? []))];
const apiPagesDir = path.join(docsDir, "api");
for (const tag of tags) {
  if (!existsSync(path.join(apiPagesDir, `${tag}.mdx`))) {
    fail(`API tag "${tag}" has no page content/docs/api/${tag}.mdx (run npm run gen-api-docs)`);
  }
}
for (const t of spec.tags ?? []) {
  if (!t.description) warn(`API tag "${t.name}" has no description`);
}

// ---------------------------------------------------------------------------------------------
// 4. Forbidden terms

// 4a. robots.txt must disallow every page that names the tools.
function robotsDisallows() {
  const built = path.join(site, "out/robots.txt");
  if (!quick && existsSync(built)) {
    return [...read(built).matchAll(/^Disallow:\s*(\S+)/gim)].map((m) => m[1]);
  }
  const src = read(path.join(site, "app/robots.ts"));
  return [...src.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]);
}
const disallowed = robotsDisallows();
for (const { url } of NAMED_PAGES) {
  if (!disallowed.some((d) => url === d || url.startsWith(d + "/"))) {
    fail(`${url} may name the download tools but is not disallowed in robots.txt`);
  }
}

// 4b. Source: only the named pages (and exempt files) may mention the tools.
const namedSource = new Set(NAMED_PAGES.flatMap((p) => p.source).map((s) => path.join(site, s)));
const isNamedSource = (file) =>
  [...namedSource].some((s) => file === s || file.startsWith(s + path.sep));
const sourceDirs = ["content", "app", "components", "lib", "public"].map((d) => path.join(site, d));
const textExt = /\.(mdx?|tsx?|mjs|json|css|txt|svg)$/;
for (const file of sourceDirs.flatMap((d) =>
  walk(d, (f) => textExt.test(f) || /manifest/.test(f)),
)) {
  if (isNamedSource(file) || SOURCE_EXEMPT.includes(rel(file))) continue;
  const text = read(file);
  const hit = text.match(STRICT);
  if (hit) fail(`${rel(file)} names "${hit[0]}" but is not one of the allowed pages`);
  // The file name itself counts too.
  if (STRICT.test(path.basename(file))) fail(`${rel(file)}: file name contains a forbidden term`);
}
// The shot manifest is published data (alt text, routes).
if (STRICT.test(JSON.stringify(manifest))) fail("lib/media-manifest.json names a forbidden term");

// 4c. The landing route must not mention the extra terms.
const landingSource = path.join(site, "app/(home)/page.tsx");
if (existsSync(landingSource) && LANDING_EXTRA.test(read(landingSource))) {
  fail(
    `app/(home)/page.tsx mentions ${read(landingSource).match(LANDING_EXTRA)[0]} (not allowed on the landing page)`,
  );
}

// 4d. Built output (full mode only).
if (!quick) {
  const out = path.join(site, "out");
  if (!existsSync(out)) {
    fail("out/ is missing: run npm run build first (or use --quick)");
  } else {
    const allowedBuilt = NAMED_PAGES.map((p) => path.join(out, p.url));
    const isAllowedBuilt = (file) =>
      allowedBuilt.some(
        (a) => file === a || file.startsWith(a + ".") || file.startsWith(a + path.sep),
      );
    for (const file of walk(out)) {
      if (!/\.(html|txt|js|json|xml|css|svg)$/.test(file)) continue;
      if (isAllowedBuilt(file)) continue;
      const hit = read(file).match(STRICT);
      if (hit)
        fail(`built ${path.relative(out, file)} names "${hit[0]}" outside the allowed pages`);
    }
    const index = path.join(out, "index.html");
    if (existsSync(index)) {
      const hit = read(index).match(LANDING_EXTRA);
      if (hit) fail(`built landing page (index.html) mentions "${hit[0]}"`);
    }
  }
}

// ---------------------------------------------------------------------------------------------

for (const w of warnings) console.warn(`warn: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  console.error(`\ncheck-coverage: ${errors.length} problem(s)`);
  process.exit(1);
}
console.log(
  `check-coverage${quick ? " (quick)" : ""}: ok, ${navRoutes.length} routes, ${usedShots.size} shots, ` +
    `${operations.length} operations in ${tags.length} API pages, ${warnings.length} warning(s)`,
);
