import { bigramSimilarity } from "./cleanupFields";
import type { FieldDef } from "@/hooks/useQueryBuilder";
import type { AudioFile } from "@/types/audio";

const DATE_UNIT_SECONDS: Record<string, number> = {
  days: 86400,
  weeks: 604800,
  months: 2592000,
};

export const audioCleanupFields: FieldDef<AudioFile>[] = [
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
      if (row.duration == null) return false;
      const v = value as number;
      return operator === "gt" ? row.duration > v : row.duration < v;
    },
  },
  {
    key: "date",
    label: "Content date",
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
      { label: "50 MB", value: 50 },
      { label: "100 MB", value: 100 },
      { label: "500 MB", value: 500 },
    ],
    test: (row, operator, value) => {
      const mb = row.size / (1024 * 1024);
      const v = value as number;
      return operator === "gt" ? mb > v : mb < v;
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
