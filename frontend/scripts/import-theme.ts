// Dev-time theme importer: converts a pasted tweakcn/shadcn export (the `.dark` block, OKLCH or HSL,
// or a shadcn registry-item JSON) into src/themes/<id>.css.
//
//   npm run theme:import -- <id> "<Label>" [--group Parallax|Colour] [--source "<attribution>"] [--force] [<file>]
//
// Reads <file>, or stdin when omitted. Prints the THEME_META line to paste into
// src/themes/registry.ts; it never edits the registry itself.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ThemeImportError,
  SAFE_THEME_ID,
  buildTheme,
  extractDarkVars,
  renderThemeCss,
} from "../src/themes/importer.ts";

const USAGE = `Usage: npm run theme:import -- <id> "<Label>" [--group Parallax|Colour] [--source "<attribution>"] [--force] [<file>]
  Reads the pasted CSS/JSON from <file> or stdin; writes src/themes/<id>.css.`;

const GROUPS = ["Parallax", "Colour"];

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let group = "Colour";
  let source: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--force") force = true;
    else if (a === "--group" || a === "--source") {
      const v = argv[++i];
      if (v === undefined) throw new ThemeImportError(`${a} needs a value`);
      if (a === "--group") group = v;
      else source = v;
    } else if (a.startsWith("--")) throw new ThemeImportError(`Unknown option ${a}`);
    else positional.push(a);
  }
  const [id, label, file, ...rest] = positional;
  if (!id || !label || rest.length) throw new ThemeImportError(USAGE);
  if (!GROUPS.includes(group)) {
    throw new ThemeImportError(`--group must be one of ${GROUPS.join(", ")}`);
  }
  return { id, label, group, source, force, file };
}

function main(): void {
  const { id, label, group, source, force, file } = parseArgs(process.argv.slice(2));
  if (!SAFE_THEME_ID.test(id)) {
    throw new ThemeImportError(`Invalid theme id "${id}": use ${SAFE_THEME_ID}`);
  }
  const out = fileURLToPath(new URL(`../src/themes/${id}.css`, import.meta.url));
  if (existsSync(out) && !force) {
    throw new ThemeImportError(`${out} already exists (use --force to overwrite)`);
  }
  if (!file && process.stdin.isTTY) {
    throw new ThemeImportError(`No input: pass a <file> or pipe the CSS/JSON on stdin\n${USAGE}`);
  }
  const text = readFileSync(file ?? 0, "utf8");

  const built = buildTheme(extractDarkVars(text));
  const css = renderThemeCss({ id, label, source, vars: built.vars, onAccent: built.onAccent });
  writeFileSync(out, css);

  console.log(`Wrote ${out}`);
  console.log(`  converted (${built.converted.length}): ${built.converted.join(", ")}`);
  for (const d of built.derived) console.log(`  derived --${d.name} <- ${d.rule}`);
  for (const w of built.warnings) console.log(`  warning: ${w}`);
  console.log("\nAdd to THEME_META in src/themes/registry.ts:");
  console.log(
    `  { id: ${JSON.stringify(id)}, label: ${JSON.stringify(label)}, group: ${JSON.stringify(group)} },`,
  );
}

try {
  main();
} catch (e) {
  if (!(e instanceof ThemeImportError)) throw e;
  console.error(e.message);
  process.exit(1);
}
