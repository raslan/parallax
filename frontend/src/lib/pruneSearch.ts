import type { FieldDef, Operator } from "@/hooks/useQueryBuilder";
import type { FileDetails, PruneFile } from "@/types/prune";
import { dateCutoffSeconds, type DateValue } from "@/lib/dateValue";

type PruneRow = PruneFile & { details?: FileDetails | null };

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

function textOf(value: unknown): string {
  return (value as { text?: string } | null)?.text ?? "";
}

/** Case-insensitive text comparison shared by the text-valued fields. */
function matchText(subjectRaw: string, operator: Operator, raw: string): boolean {
  // NFC both sides so decomposed (macOS) Hangul names match composed queries.
  const subject = subjectRaw.normalize("NFC");
  if (operator === "regex") {
    const re = compileRegex(raw.normalize("NFC"));
    return re ? re.test(subject) : false;
  }
  const s = subject.toLowerCase();
  const q = raw.normalize("NFC").toLowerCase();
  switch (operator) {
    case "contains":
      return s.includes(q);
    case "not_contains":
      return !s.includes(q);
    case "starts_with":
      return s.startsWith(q);
    case "ends_with":
      return s.endsWith(q);
    case "eq":
      return s === q;
    case "neq":
      return s !== q;
    default:
      return true;
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function compareNumber(actual: number, operator: Operator, v: number): boolean {
  return operator === "gt" ? actual > v : actual < v;
}

/** @public — consumed by the Prune page in the page-wiring task. */
export const pruneFields: FieldDef<PruneRow>[] = [
  {
    key: "name",
    label: "Name",
    category: "search",
    valueType: "text",
    operators: ["contains", "not_contains", "starts_with", "ends_with", "eq", "regex"],
    defaultOperator: "contains",
    defaultValue: { text: "" },
    test: (row, operator, value) => {
      const q = textOf(value);
      if (!q) return true;
      return matchText(row.name, operator, q);
    },
  },
  {
    key: "extension",
    label: "Extension",
    category: "search",
    valueType: "text",
    operators: ["eq", "neq"],
    defaultOperator: "eq",
    defaultValue: { text: "" },
    test: (row, operator, value) => {
      const q = textOf(value).trim().replace(/^\./, "");
      if (!q) return true;
      return matchText(extensionOf(row.name), operator, q);
    },
  },
  {
    key: "kind",
    label: "Type",
    category: "label",
    valueType: "select",
    operators: ["eq", "neq"],
    defaultOperator: "eq",
    defaultValue: "video",
    options: [
      { label: "Video", value: "video" },
      { label: "Image", value: "image" },
      { label: "Audio", value: "audio" },
      { label: "Other", value: "other" },
    ],
    test: (row, operator, value) => (operator === "neq" ? row.kind !== value : row.kind === value),
  },
  {
    key: "size",
    label: "File size",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "gt",
    defaultValue: 100,
    unitLabel: "MB",
    presets: [
      { label: "10 MB", value: 10 },
      { label: "100 MB", value: 100 },
      { label: "500 MB", value: 500 },
      { label: "1 GB", value: 1000 },
    ],
    test: (row, operator, value) =>
      compareNumber(row.size / (1024 * 1024), operator, value as number),
  },
  {
    key: "modified",
    label: "Modified",
    category: "numeric",
    valueType: "date_offset",
    operators: ["gt", "lt"], // gt = after, lt = before
    defaultOperator: "lt",
    defaultValue: { n: 30, unit: "days" },
    test: (row, operator, value) => {
      const cutoff = dateCutoffSeconds(value as DateValue);
      return operator === "gt" ? row.mtime > cutoff : row.mtime < cutoff;
    },
  },
  {
    key: "duration",
    label: "Duration",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "lt",
    defaultValue: 30,
    unitLabel: "seconds",
    test: (row, operator, value) => {
      const d = row.details?.duration;
      if (d == null) return false;
      return compareNumber(d, operator, value as number);
    },
  },
  {
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
      const w = row.details?.width;
      const h = row.details?.height;
      if (w == null || h == null) return false;
      return compareNumber(Math.min(w, h), operator, value as number);
    },
  },
  {
    key: "codec",
    label: "Codec",
    category: "search",
    valueType: "text",
    operators: ["eq", "neq", "contains", "not_contains"],
    defaultOperator: "eq",
    defaultValue: { text: "" },
    test: (row, operator, value) => {
      const codec = row.details?.codec;
      if (codec == null) return false;
      const q = textOf(value).trim();
      if (!q) return true;
      return matchText(codec, operator, q);
    },
  },
  {
    key: "bitrate",
    label: "Bitrate",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "gt",
    defaultValue: 5000,
    unitLabel: "kbps",
    test: (row, operator, value) => {
      const b = row.details?.bitrate;
      if (b == null) return false;
      return compareNumber(b / 1000, operator, value as number);
    },
  },
];
