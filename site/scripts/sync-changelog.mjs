// Builds content/docs/getting-started/changelog.mdx from the repo's CHANGELOG.md.
// Only the latest releases are listed (the rest is on GitHub). Entries about the
// downloader tools and Galleries are dropped: the site never names those tools and
// keeps Galleries low-key. Output is generated and gitignored.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../CHANGELOG.md");
const target = path.resolve(here, "../content/docs/getting-started/changelog.mdx");
const MAX_RELEASES = 8;
const HIDDEN = /yt-?dlp|youtube-?dl|gallery-?dl|galler|ytdl/i;

const mdx = (s) =>
  s
    .replace(/\s*\(\[[0-9a-f]{7,}\]\([^)]*\)\)\s*$/, "") // trailing commit link
    .replace(/\\/g, "\\\\")
    .replace(/[{}]/g, (c) => `\\${c}`)
    .replace(/</g, "&lt;")
    .replace(/\*\*([^*]+):\*\*\s*/, "$1: ") // "**scope:** text" -> "scope: text"
    .replace(/\bPrune\b/g, "Organize") // the page was renamed
    .replace(/\bprune\b/g, "organize");

const text = readFileSync(source, "utf8");
const releases = text.split(/^## \[/m).slice(1, 1 + MAX_RELEASES);

let out = `---
title: Changelog
description: What changed in the latest Parallax releases.
---

The most recent releases are listed here. Older ones are on the [releases page](https://github.com/raslan/parallax/releases).

`;

for (const block of releases) {
  const head = block.match(/^([^\]]+)\]\(([^)]*)\)\s*\(([^)]*)\)/);
  if (!head) continue;
  const [, version, url, date] = head;
  out += `## ${version} (${date})\n\n[Full list of changes on GitHub](${url})\n\n`;
  for (const section of block.split(/^### /m).slice(1)) {
    const [title, ...lines] = section.split("\n");
    const items = lines
      .filter((l) => l.startsWith("* "))
      .map((l) => l.slice(2))
      .filter((l) => !HIDDEN.test(l))
      .map(mdx);
    if (items.length === 0) continue;
    out += `### ${title.trim()}\n\n${items.map((i) => `- ${i}`).join("\n")}\n\n`;
  }
}

writeFileSync(target, out);
console.log(`sync-changelog: wrote ${releases.length} releases`);
