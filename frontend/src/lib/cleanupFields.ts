import type { FieldDef } from "@/hooks/useQueryBuilder";
import type { VideoFile } from "@/types/file";

function bigramSimilarity(a: string, b: string): number {
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

const DATE_UNIT_SECONDS: Record<string, number> = {
  days: 86400,
  weeks: 604800,
  months: 2592000,
};

export const cleanupFields: FieldDef<VideoFile>[] = [
  {
    key: "duration",
    label: "Duration",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "lt",
    defaultValue: 30,
    test: (row, operator, value) => {
      if (row.duration == null) return false;
      const v = value as number;
      return operator === "gt" ? row.duration > v : row.duration < v;
    },
  },
  {
    key: "fps",
    label: "Framerate",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "lt",
    defaultValue: 24,
    test: (row, operator, value) => {
      if (row.file_fps == null) return false;
      const v = value as number;
      return operator === "gt" ? row.file_fps > v : row.file_fps < v;
    },
  },
  {
    key: "date",
    label: "Date added",
    category: "numeric",
    valueType: "date_offset",
    operators: ["gt", "lt"], // gt = after, lt = before
    defaultOperator: "lt",
    defaultValue: { n: 30, unit: "days" },
    test: (row, operator, value) => {
      if (row.file_date == null) return false;
      const v = value as { n: number; unit: string };
      const cutoff = Date.now() / 1000 - v.n * (DATE_UNIT_SECONDS[v.unit] ?? 86400);
      return operator === "gt" ? row.file_date > cutoff : row.file_date < cutoff;
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
    presets: [
      { label: "4K/UHD", value: 2160 },
      { label: "1440p", value: 1440 },
      { label: "1080p", value: 1080 },
      { label: "720p", value: 720 },
      { label: "480p", value: 480 },
    ],
    test: (row, operator, value) => {
      if (row.file_height == null) return false;
      const v = value as number;
      return operator === "gt" ? row.file_height > v : row.file_height < v;
    },
  },
  {
    key: "filename",
    label: "Filename",
    category: "search",
    valueType: "text",
    operators: ["contains", "not_contains", "fuzzy_contains"],
    defaultOperator: "contains",
    defaultValue: { text: "" },
    test: (row, operator, value) => {
      const v = value as { text: string; threshold?: number };
      const q = v.text.trim().toLowerCase();
      if (!q) return true;
      const name = row.filename.toLowerCase();
      if (operator === "fuzzy_contains") {
        return bigramSimilarity(name, q) >= (v.threshold ?? 40) / 100;
      }
      const matches = name.includes(q);
      return operator === "not_contains" ? !matches : matches;
    },
  },
];
