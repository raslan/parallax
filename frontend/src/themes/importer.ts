// Theme importer core: turns a pasted tweakcn/shadcn export into the bare-HSL-triplet variable set
// the theme files use. Pure and dependency-free (no fs) so it runs in node (scripts/import-theme.ts)
// and in tests. Only the dark half is read: Parallax is dark-only.

/** The shadcn variables every theme file must define (registry.test.ts enforces the same list). */
export const REQUIRED_VARS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-border",
  "sidebar-accent",
] as const;

export const SAFE_THEME_ID = /^[a-z0-9-]{1,32}$/;

/** The global dark text colour used on accent-filled surfaces (`--px-on-accent` in index.css). */
const DEFAULT_ON_ACCENT = "#0a0a0f";
const LIGHT_ON_ACCENT = "#ffffff";
const MIN_CONTRAST = 4.5;

export class ThemeImportError extends Error {}

/** Gamma-encoded sRGB, channels 0-1, alpha 0-1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Parsed extends Rgb {
  /** The source colour was outside the sRGB gamut and has been clamped. */
  clipped: boolean;
}

// ---------------------------------------------------------------------------------------------
// Parsing

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const NAMED: Record<string, [number, number, number, number]> = {
  white: [1, 1, 1, 1],
  black: [0, 0, 0, 1],
  transparent: [0, 0, 0, 0],
};

function fail(name: string, value: string, why: string): never {
  throw new ThemeImportError(`--${name}: cannot parse "${value}" (${why})`);
}

/** `none` -> 0, `N%` -> N/100 * full, `N` -> N. */
function component(tok: string, full: number, name: string, value: string): number {
  if (tok.toLowerCase() === "none") return 0;
  if (tok.endsWith("%")) {
    const n = tok.slice(0, -1);
    if (!NUM.test(n)) fail(name, value, `bad percentage "${tok}"`);
    return (Number(n) / 100) * full;
  }
  if (!NUM.test(tok)) fail(name, value, `unsupported token "${tok}"`);
  return Number(tok);
}

/** Hue to degrees; accepts deg (default), turn, rad, grad. */
function hue(tok: string, name: string, value: string): number {
  if (tok.toLowerCase() === "none") return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|turn|rad|grad)?$/i.exec(tok);
  if (!m) fail(name, value, `bad hue "${tok}"`);
  const n = Number(m[1]);
  switch ((m[2] ?? "deg").toLowerCase()) {
    case "turn":
      return n * 360;
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    default:
      return n;
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Clamp to the sRGB gamut (simple per-channel clamp; flags when anything moved noticeably). */
function finish(r: number, g: number, b: number, a: number): Parsed {
  const EPS = 1e-3;
  const clipped = [r, g, b].some((c) => c < -EPS || c > 1 + EPS);
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: clamp01(a), clipped };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  const sat = clamp01(s);
  const lig = clamp01(l);
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const ch = (t: number) => {
    const x = (t + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [ch(hh + 1 / 3), ch(hh), ch(hh - 1 / 3)];
}

/** Björn Ottosson's OKLab matrices (same ones CSS Color 4 uses), OKLCH -> gamma sRGB. */
function oklchToRgb(L: number, C: number, H: number, a: number): Parsed {
  const hr = (H * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [r, g, b] = lin.map((v) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055,
  ) as [number, number, number];
  return finish(r, g, b, a);
}

/**
 * Parse one CSS colour value. Supported: `oklch()`, `hsl()/hsla()` (comma or space syntax), bare
 * HSL triplets (`220 28% 6%`), `#rgb/#rgba/#rrggbb/#rrggbbaa`, `rgb()/rgba()`, `white`, `black`,
 * `transparent`. Anything else (`var()`, `calc()`, `color-mix()`, relative colours, lab/lch/color())
 * throws a ThemeImportError naming the variable.
 */
export function parseColor(value: string, name = "colour"): Parsed {
  const v = value.trim().replace(/\s*!important$/i, "");
  const lower = v.toLowerCase();

  const named = NAMED[lower];
  if (named) return finish(...named);

  if (lower.startsWith("#")) {
    const hex = lower.slice(1);
    if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(hex)) fail(name, value, "bad hex colour");
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const byte = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
    return finish(byte(0), byte(2), byte(4), full.length === 8 ? byte(6) : 1);
  }

  const fn = /^([a-z-]+)\(\s*([^()]*?)\s*\)$/i.exec(v);
  let fnName = "";
  let body = v;
  if (fn) {
    fnName = (fn[1] ?? "").toLowerCase();
    body = fn[2] ?? "";
  } else if (v.includes("(")) {
    fail(name, value, "unsupported colour syntax (only oklch, hsl, rgb, hex, HSL triplets)");
  }
  if (fn && !["oklch", "hsl", "hsla", "rgb", "rgba"].includes(fnName)) {
    fail(name, value, `unsupported colour function ${fnName}()`);
  }

  const [main = "", alphaTok, ...extra] = body.split("/").map((s) => s.trim());
  if (extra.length) fail(name, value, "too many '/'");
  const toks = main.split(/[\s,]+/).filter(Boolean);
  // Legacy comma syntax can carry alpha as a 4th component: hsla(220, 28%, 6%, 0.5).
  let alphaStr = alphaTok;
  if (toks.length === 4 && alphaStr === undefined) alphaStr = toks.pop();
  if (toks.length !== 3) fail(name, value, "expected three colour components");
  const [t0 = "", t1 = "", t2 = ""] = toks;
  const alpha = alphaStr === undefined ? 1 : component(alphaStr, 1, name, value);

  if (fnName === "oklch") {
    return oklchToRgb(
      component(t0, 1, name, value),
      component(t1, 0.4, name, value),
      hue(t2, name, value),
      alpha,
    );
  }
  if (fnName === "rgb" || fnName === "rgba") {
    const ch = (t: string) => component(t, 255, name, value) / 255;
    return finish(ch(t0), ch(t1), ch(t2), alpha);
  }
  // hsl(), hsla() or a bare triplet.
  const pct = (t: string) => component(t, 100, name, value) / 100;
  const [r, g, b] = hslToRgb(hue(t0, name, value), pct(t1), pct(t2));
  return finish(r, g, b, alpha);
}

// ---------------------------------------------------------------------------------------------
// Conversion and maths

function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** `H S% L%` with integer values, the format the theme files use (e.g. `220 28% 6%`). */
export function toTriplet(c: Rgb): string {
  const { h, s, l } = toHsl(c);
  return `${Math.round(h) % 360} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Composite a translucent colour over a solid backdrop in gamma-sRGB space (what CSS does). Our
 * variables are solid colours consumed as `hsl(var(--x))`, so alpha colours are flattened over the
 * theme's `--background` at import time.
 */
export function compositeOver(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio (1-21) between two colours (parsed Rgb or any parseable colour string). */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const la = luminance(typeof a === "string" ? parseColor(a) : a);
  const lb = luminance(typeof b === "string" ? parseColor(b) : b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------------------------
// Extraction from pasted text

// Strip block comments.
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function isDarkSelector(sel: string): boolean {
  return sel
    .split(",")
    .map((s) => s.trim())
    .some((s) => /^(\.dark|:root\.dark|html\.dark|\[data-theme=(["']?)dark\2\])$/.test(s));
}

function parseDeclarations(body: string, into: Record<string, string>): void {
  for (const decl of body.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    if (!prop.startsWith("--")) continue;
    into[prop.slice(2)] = decl
      .slice(i + 1)
      .trim()
      .replace(/\s*!important$/i, "");
  }
}

/** Dark-mode custom properties of a CSS export: every `.dark`-ish block merged, light/`@theme` ignored. */
function extractFromCss(css: string): Record<string, string> {
  const text = stripComments(css);
  const out: Record<string, string> = {};
  let found = false;
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const selector = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    if (depth > 0) throw new ThemeImportError("Unbalanced braces in the pasted CSS");
    if (!selector.startsWith("@") && isDarkSelector(selector)) {
      found = true;
      parseDeclarations(text.slice(open + 1, j - 1), out);
    }
    i = j;
  }
  if (!found) {
    throw new ThemeImportError(
      "No `.dark { ... }` block found in the pasted CSS. Parallax is dark-only, so the dark half is required (the light block is not used).",
    );
  }
  return out;
}

function extractFromJson(text: string): Record<string, string> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ThemeImportError("The pasted text looks like JSON but does not parse");
  }
  const dark = (data as { cssVars?: { dark?: unknown } } | null)?.cssVars?.dark;
  if (!dark || typeof dark !== "object") {
    throw new ThemeImportError(
      "No `cssVars.dark` object found in the registry-item JSON (the light half is not used)",
    );
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dark)) {
    if (typeof v === "string") out[k.replace(/^--/, "")] = v.trim();
  }
  return out;
}

/** Pasted CSS (`:root` + `.dark`) or shadcn registry-item JSON -> the dark variables, keyed without `--`. */
export function extractDarkVars(text: string): Record<string, string> {
  const t = text.trim();
  if (!t) throw new ThemeImportError("Nothing to import: the pasted text is empty");
  return t.startsWith("{") && /^\{\s*"/.test(t) ? extractFromJson(t) : extractFromCss(t);
}

// ---------------------------------------------------------------------------------------------
// Building the theme

export interface BuiltTheme {
  /** Bare HSL triplets for every REQUIRED_VARS entry. */
  vars: Record<string, string>;
  /** Variables read from the source. */
  converted: string[];
  /** Variables missing from the source and derived (rule in the string). */
  derived: { name: string; rule: string }[];
  warnings: string[];
  /** Set when the global dark `--px-on-accent` would be unreadable on this primary. */
  onAccent?: string;
}

/**
 * Convert extracted variables to a full theme. Only the REQUIRED_VARS are read (fonts, radius,
 * shadows, tracking, chart-*, destructive*, sidebar-primary*, ... are ignored). `background`,
 * `foreground` and `primary` are mandatory; everything else missing is derived:
 *   card / popover <- background (popover <- card), their foregrounds <- foreground,
 *   primary-foreground <- background, secondary / muted / accent <- either of the other two, else card,
 *   secondary-/accent-foreground <- foreground, muted-foreground <- foreground 65% over background,
 *   border <- foreground 12% over background, input <- border, ring <- primary,
 *   sidebar <- background, sidebar-foreground <- foreground, sidebar-border <- border,
 *   sidebar-accent <- accent.
 * Translucent colours are flattened over `background`. Out-of-gamut colours are clamped (warned).
 */
export function buildTheme(source: Record<string, string>): BuiltTheme {
  const warnings: string[] = [];
  const solid: Record<string, Rgb> = {};
  const converted: string[] = [];
  const derived: BuiltTheme["derived"] = [];

  for (const req of ["background", "foreground", "primary"]) {
    if (source[req] === undefined) {
      throw new ThemeImportError(`Missing required variable --${req} in the dark block`);
    }
  }
  const bgParsed = parseColor(source["background"] ?? "", "background");
  const bg = compositeOver(bgParsed, { r: 0, g: 0, b: 0, a: 1 });
  if (bgParsed.a < 1) warnings.push("--background is translucent; flattened over black");
  solid["background"] = bg;

  for (const name of REQUIRED_VARS) {
    const raw = source[name];
    if (raw === undefined) continue;
    const p = parseColor(raw, name);
    if (p.clipped) warnings.push(`--${name}: out of sRGB gamut, clipped (${raw.trim()})`);
    if (p.a < 1 && name !== "background") {
      warnings.push(`--${name}: translucent, flattened over --background`);
    }
    solid[name] = name === "background" ? bg : compositeOver(p, bg);
    converted.push(name);
  }

  const mix = (fg: Rgb, t: number): Rgb => compositeOver({ ...fg, a: t }, bg);
  const first = (...names: string[]): Rgb | undefined => {
    for (const n of names) if (solid[n]) return solid[n];
    return undefined;
  };
  const need = (name: string): Rgb => {
    const c = solid[name];
    if (!c) throw new ThemeImportError(`internal: --${name} not resolved`);
    return c;
  };
  const derive = (name: string, rule: string, make: () => Rgb | undefined): void => {
    if (solid[name]) return;
    const c = make();
    if (!c) return;
    solid[name] = c;
    derived.push({ name, rule });
  };
  const fgc = need("foreground");

  derive("card", "background", () => bg);
  derive("popover", "card", () => need("card"));
  derive("card-foreground", "foreground", () => fgc);
  derive("popover-foreground", "foreground", () => fgc);
  derive("primary-foreground", "background", () => bg);
  derive("secondary", "muted/accent, else card", () => first("muted", "accent") ?? need("card"));
  derive(
    "muted",
    "secondary/accent, else card",
    () => first("secondary", "accent") ?? need("card"),
  );
  derive("accent", "secondary/muted, else card", () => first("secondary", "muted") ?? need("card"));
  derive("secondary-foreground", "foreground", () => fgc);
  derive("muted-foreground", "foreground 65% over background", () => mix(fgc, 0.65));
  derive("accent-foreground", "foreground", () => fgc);
  derive("border", "foreground 12% over background", () => mix(fgc, 0.12));
  derive("input", "border", () => need("border"));
  derive("ring", "primary", () => need("primary"));
  derive("sidebar", "background", () => bg);
  derive("sidebar-foreground", "foreground", () => fgc);
  derive("sidebar-border", "border", () => need("border"));
  derive("sidebar-accent", "accent", () => need("accent"));

  const vars: Record<string, string> = {};
  for (const name of REQUIRED_VARS) vars[name] = toTriplet(need(name));

  // Judge contrast on what will actually render (the rounded triplets).
  const primary = parseColor(vars["primary"] ?? "");
  let onAccent: string | undefined;
  if (contrastRatio(primary, DEFAULT_ON_ACCENT) < MIN_CONTRAST) {
    if (contrastRatio(primary, LIGHT_ON_ACCENT) > contrastRatio(primary, DEFAULT_ON_ACCENT)) {
      onAccent = LIGHT_ON_ACCENT;
    }
    warnings.push(
      `--primary is too dark for the default dark --px-on-accent (contrast < ${MIN_CONTRAST}:1)` +
        (onAccent ? `; emitting --px-on-accent: ${onAccent}` : "; no better colour found"),
    );
  }

  return { vars, converted, derived, warnings, onAccent };
}

// ---------------------------------------------------------------------------------------------
// Rendering

export interface RenderInput {
  id: string;
  label: string;
  /** Attribution, e.g. "tweakcn 'Amber Minimal' (https://tweakcn.com/...)". */
  source?: string;
  vars: Record<string, string>;
  /** Per-theme `--px-on-accent` override (see BuiltTheme.onAccent). */
  onAccent?: string;
}

/** The text of `src/themes/<id>.css`, laid out like the hand-written theme files. */
export function renderThemeCss({ id, label, source, vars, onAccent }: RenderInput): string {
  if (!SAFE_THEME_ID.test(id)) {
    throw new ThemeImportError(
      `Invalid theme id "${id}": use ${SAFE_THEME_ID} (lowercase, digits, -)`,
    );
  }
  const safe = (s: string) => s.replace(/\*\//g, "* /").replace(/\s+/g, " ").trim();
  const lines = [`/* ${safe(label)}: imported theme.`];
  if (source) lines.push(`   Source: ${safe(source)}`);
  lines.push(
    "   Generated by scripts/import-theme.ts; the tokens below are plain HSL triplets, edit freely. */",
  );
  lines.push(`[data-theme="${id}"] {`);
  for (const name of REQUIRED_VARS) {
    const v = vars[name];
    if (!v || !/^\d{1,3} \d{1,3}% \d{1,3}%$/.test(v)) {
      throw new ThemeImportError(`--${name}: expected an "H S% L%" triplet, got "${v ?? ""}"`);
    }
    lines.push(`  --${name}: ${v};`);
  }
  if (onAccent) {
    lines.push("");
    lines.push(
      "  /* The primary is too dark for the default dark text on accent-filled surfaces. */",
    );
    lines.push(`  --px-on-accent: ${onAccent};`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

/** Convenience: pasted text -> built theme. */
export function importTheme(text: string): BuiltTheme {
  return buildTheme(extractDarkVars(text));
}
