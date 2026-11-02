import type { FieldDef, Operator } from "@/hooks/useQueryBuilder";
import { dateCutoffSeconds, type DateValue } from "@/lib/dateValue";

/**
 * Field factories shared by the file filter registries (`cleanupFields`,
 * `audioCleanupFields`, `pruneFields`), so "Duration", "File size", "Resolution",
 * "Orientation", the date fields and "Filename" mean the same thing on every page.
 * Each takes a getter over the page's own row shape; a getter returning null /
 * undefined (missing metadata) makes the clause not match.
 */

type Num = number | null | undefined;

export function bigramSimilarity(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (t.length === 0) return 1;
  if (s.length < 2 || t.length < 2) return s.includes(t) ? 1 : 0;
  const bigrams = (str: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      set.set(bg, (set.get(bg) ?? 0) + 1);
    }
    return set;
  };
  const sa = bigrams(s);
  const tb = bigrams(t);
  let intersection = 0;
  for (const [bg, cnt] of tb) intersection += Math.min(cnt, sa.get(bg) ?? 0);
  return (2 * intersection) / (s.length - 1 + t.length - 1);
}

const compare = (actual: number, operator: Operator, v: number) =>
  operator === "gt" ? actual > v : actual < v;

export function durationField<T>(get: (row: T) => Num): FieldDef<T> {
  return {
    key: "duration",
    label: "Duration",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "lt",
    defaultValue: 30,
    unitLabel: "seconds",
    test: (row, operator, value) => {
      const d = get(row);
      if (d == null) return false;
      return compare(d, operator, value as number);
    },
  };
}

/** A date compared against an "N days ago" / absolute cutoff (gt = after, lt = before). */
export function dateField<T>(key: string, label: string, get: (row: T) => Num): FieldDef<T> {
  return {
    key,
    label,
    category: "numeric",
    valueType: "date_offset",
    operators: ["gt", "lt"], // gt = after, lt = before
    defaultOperator: "lt",
    defaultValue: { n: 30, unit: "days" },
    test: (row, operator, value) => {
      const t = get(row);
      if (t == null) return false;
      const cutoff = dateCutoffSeconds(value as DateValue);
      return operator === "gt" ? t > cutoff : t < cutoff;
    },
  };
}

/** File size in MB; the default and the quick-set presets suit each page's media. */
export function sizeField<T>(
  get: (row: T) => number,
  { defaultValue, presets }: { defaultValue: number; presets: { label: string; value: number }[] },
): FieldDef<T> {
  return {
    key: "size",
    label: "File size",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "gt",
    defaultValue,
    unitLabel: "MB",
    presets,
    test: (row, operator, value) => compare(get(row) / (1024 * 1024), operator, value as number),
  };
}

export function orientationField<T>(
  getWidth: (row: T) => Num,
  getHeight: (row: T) => Num,
): FieldDef<T> {
  return {
    key: "orientation",
    label: "Orientation",
    category: "numeric",
    valueType: "select",
    operators: ["eq"],
    defaultOperator: "eq",
    defaultValue: "portrait",
    options: [
      { label: "Portrait", value: "portrait" },
      { label: "Landscape", value: "landscape" },
      { label: "Square", value: "square" },
    ],
    test: (row, _operator, value) => {
      const w = getWidth(row);
      const h = getHeight(row);
      if (w == null || h == null) return false;
      const orientation = w === h ? "square" : w > h ? "landscape" : "portrait";
      return orientation === value;
    },
  };
}

/**
 * Shortest side of the frame in px (1080p = 1080 whether the clip is landscape or
 * portrait), with the usual 4K…480p presets.
 */
export function resolutionField<T>(
  getWidth: (row: T) => Num,
  getHeight: (row: T) => Num,
): FieldDef<T> {
  return {
    key: "resolution",
    label: "Resolution",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "lt",
    defaultValue: 480,
    unitLabel: "px short side",
    presets: [
      { label: "4K/UHD", value: 2160 },
      { label: "1440p", value: 1440 },
      { label: "1080p", value: 1080 },
      { label: "720p", value: 720 },
      { label: "480p", value: 480 },
    ],
    test: (row, operator, value) => {
      const w = getWidth(row);
      const h = getHeight(row);
      if (w == null || h == null) return false;
      return compare(Math.min(w, h), operator, value as number);
    },
  };
}

// One compiled regex is reused across the rows of a filter pass.
let cachedSource: string | null = null;
let cachedRegex: RegExp | null = null;

/** Case-insensitive regex, or null when the pattern is invalid (matches nothing). */
function compileRegex(source: string): RegExp | null {
  if (source !== cachedSource) {
    cachedSource = source;
    try {
      cachedRegex = new RegExp(source, "iu");
    } catch {
      try {
        cachedRegex = new RegExp(source, "i");
      } catch {
        cachedRegex = null;
      }
    }
  }
  return cachedRegex;
}

/**
 * The filename search: case-insensitive, the query trimmed; `fuzzy_contains` is the
 * bigram similarity against the clause's threshold (default 40%). Pages opt into
 * more operators (`starts_with`, `ends_with`, `eq`, `regex` — an invalid pattern
 * matches nothing and never throws; the pattern itself is not trimmed) and into NFC
 * normalisation of both sides (`nfc`, so decomposed macOS names match composed
 * queries).
 */
export function filenameField<T>(
  get: (row: T) => string,
  {
    key = "filename",
    label = "Filename",
    operators = ["contains", "not_contains", "fuzzy_contains"],
    nfc = false,
  }: { key?: string; label?: string; operators?: Operator[]; nfc?: boolean } = {},
): FieldDef<T> {
  const norm = (s: string) => (nfc ? s.normalize("NFC") : s);
  return {
    key,
    label,
    category: "search",
    valueType: "text",
    operators,
    defaultOperator: "contains",
    defaultValue: { text: "" },
    test: (row, operator, value) => {
      const v = value as { text: string; threshold?: number };
      const raw = norm(v.text);
      const q = raw.trim().toLowerCase();
      if (!q) return true;
      if (operator === "regex") {
        const re = compileRegex(raw);
        return re ? re.test(norm(get(row))) : false;
      }
      const name = norm(get(row)).toLowerCase();
      switch (operator) {
        case "fuzzy_contains":
          return bigramSimilarity(name, q) >= (v.threshold ?? 40) / 100;
        case "not_contains":
          return !name.includes(q);
        case "starts_with":
          return name.startsWith(q);
        case "ends_with":
          return name.endsWith(q);
        case "eq":
          return name === q;
        default:
          return name.includes(q);
      }
    },
  };
}
