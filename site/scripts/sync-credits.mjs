// Builds lib/credits.generated.json from the app's single credits file
// (../backend/app/assets/credits.json). Only entries marked `show.site` are kept, and empty
// groups are dropped, so the downloader tools (app-only) never reach the public site.
// Fails the build if a forbidden term slips through. Output is generated and gitignored.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../backend/app/assets/credits.json");
const target = path.resolve(here, "../lib/credits.generated.json");
const FORBIDDEN = /yt[-_]?dlp|ytdl|youtube[-_]?dl|gallery[-_]?dl|gallerydl/i;

const data = JSON.parse(readFileSync(source, "utf8"));
const entries = data.entries.filter((e) => e.show?.site);
const used = new Set(entries.map((e) => e.group));
const groups = data.groups.filter((g) => used.has(g.id));

// `show` is bookkeeping for the two readers; the page does not need it.
const out = {
  groups,
  entries: entries.map(({ show: _show, ...rest }) => rest),
};
const json = JSON.stringify(out, null, 2);

const hit = json.match(FORBIDDEN);
if (hit) {
  console.error(
    `sync-credits: forbidden term "${hit[0]}" in site credits. Mark that entry show.site=false.`,
  );
  process.exit(1);
}

writeFileSync(target, json + "\n");
console.log(`sync-credits: ${entries.length} entries in ${groups.length} groups`);
