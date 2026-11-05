// Builds lib/credits.generated.json from the app's single credits file
// (../backend/app/assets/credits.json). Only entries marked `show.site` are kept, and empty
// groups are dropped. An entry's `site_description`, when set, replaces its description here.
// The two download tools may be named on the Acknowledgements page (vaguely); any other entry
// that mentions them fails the build. Output is generated and gitignored.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../backend/app/assets/credits.json");
const target = path.resolve(here, "../lib/credits.generated.json");
const FORBIDDEN = /yt[-_]?dlp|ytdl|youtube[-_]?dl|gallery[-_]?dl|gallerydl/i;
const NAMED_ON_SITE = new Set(["ytdlp", "gallerydl"]);

const data = JSON.parse(readFileSync(source, "utf8"));
const entries = data.entries.filter((e) => e.show?.site);
const used = new Set(entries.map((e) => e.group));
const groups = data.groups.filter((g) => used.has(g.id));

// `show` and `site_description` are bookkeeping for the readers; the page does not need them.
const out = {
  groups,
  entries: entries.map(({ show: _show, site_description, ...rest }) => ({
    ...rest,
    description: site_description ?? rest.description,
  })),
};

for (const e of out.entries) {
  if (NAMED_ON_SITE.has(e.id)) continue;
  const hit = JSON.stringify(e).match(FORBIDDEN);
  if (hit) {
    console.error(
      `sync-credits: forbidden term "${hit[0]}" in site entry "${e.id}". Mark it show.site=false.`,
    );
    process.exit(1);
  }
}

writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`sync-credits: ${entries.length} entries in ${groups.length} groups`);
