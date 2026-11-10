import type { FieldDef, Operator } from "@/hooks/useQueryBuilder";
import type { FileDetails, OrganizeFile, OrganizeTagInfo } from "@/types/organize";
import {
  dateField,
  durationField,
  filenameField,
  orientationField,
  resolutionField,
  sizeField,
} from "@/lib/fileFieldFactories";
import { extensionOf } from "@/lib/path";

type OrganizeRow = OrganizeFile & {
  details?: FileDetails | null;
  /** undefined until the file's tags have loaded; null when it has none to read. */
  tags?: OrganizeTagInfo | null;
};

/** The tags a filter can test, in the order the fields are listed. */
const TAG_FILTERS = [
  ["title", "Title"],
  ["description", "Description"],
  ["artist", "Artist"],
  ["album", "Album"],
  ["genre", "Genre"],
  ["comment", "Comment"],
  ["date", "Date"],
] as const;

/** A loaded file's value for a tag ("" when it has none); undefined until its tags load. */
function tagValue(row: OrganizeRow, name: string): string | undefined {
  // Unloaded, or a file that cannot carry tags (a .txt is not "missing a title").
  if (row.tags === undefined || row.kind === "other") return undefined;
  return row.tags?.fields[name] ?? "";
}

function textOf(value: unknown): string {
  return (value as { text?: string } | null)?.text ?? "";
}

/** Case-insensitive, NFC-normalised comparison for the extension and codec fields. */
function matchText(subjectRaw: string, operator: Operator, raw: string): boolean {
  // NFC both sides so decomposed (macOS) names match composed queries.
  const s = subjectRaw.normalize("NFC").toLowerCase();
  const q = raw.normalize("NFC").toLowerCase();
  switch (operator) {
    case "contains":
      return s.includes(q);
    case "not_contains":
      return !s.includes(q);
    case "eq":
      return s === q;
    case "neq":
      return s !== q;
    default:
      return true;
  }
}

/**
 * Organize's filter fields. Name, size, file added, duration, resolution and
 * orientation are the shared definitions Cleanup uses (`fileFieldFactories`); name
 * adds starts/ends/exact/regex and NFC matching, the size presets suit a mixed
 * folder. Details-backed fields are false until a file's details have loaded.
 */
export const organizeFields: FieldDef<OrganizeRow>[] = [
  filenameField((r) => r.name, {
    key: "name",
    label: "Name",
    operators: [
      "contains",
      "not_contains",
      "fuzzy_contains",
      "starts_with",
      "ends_with",
      "eq",
      "regex",
    ],
    nfc: true,
  }),
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
  sizeField((r) => r.size, {
    defaultValue: 100,
    presets: [
      { label: "10 MB", value: 10 },
      { label: "100 MB", value: 100 },
      { label: "500 MB", value: 500 },
      { label: "1 GB", value: 1000 },
    ],
  }),
  dateField("file_added", "File added", (r) => r.mtime),
  durationField((r) => r.details?.duration),
  resolutionField(
    (r) => r.details?.width,
    (r) => r.details?.height,
  ),
  orientationField(
    (r) => r.details?.width,
    (r) => r.details?.height,
  ),
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
      const kbps = b / 1000;
      return operator === "gt" ? kbps > (value as number) : kbps < (value as number);
    },
  },
  // Tags stream in after the list, like details: false until a file's tags have loaded.
  ...TAG_FILTERS.map(([name, label]): FieldDef<OrganizeRow> => ({
    key: `tag_${name}`,
    label: `Tag: ${label}`,
    category: "search",
    valueType: "text",
    operators: ["contains", "not_contains", "eq", "neq"],
    defaultOperator: "contains",
    defaultValue: { text: "" },
    test: (row, operator, value) => {
      const v = tagValue(row, name);
      if (v === undefined) return false;
      const q = textOf(value).trim();
      if (!q) return true;
      return matchText(v, operator, q);
    },
  })),
  {
    key: "tag_missing",
    label: "Missing tag",
    category: "label",
    valueType: "select",
    operators: ["eq", "neq"],
    defaultOperator: "eq",
    defaultValue: "title",
    options: TAG_FILTERS.map(([name, label]) => ({ label, value: name })),
    test: (row, operator, value) => {
      const v = tagValue(row, String(value));
      if (v === undefined) return false;
      return operator === "neq" ? v !== "" : v === "";
    },
  },
];
