import type { FieldDef } from "@/hooks/useQueryBuilder";
import type { ImageFile } from "@/types/image";

const LABEL_GROUPS: { label: string; labels: string[] }[] = [
  {
    label: "Exposed",
    labels: [
      "FEMALE_BREAST_EXPOSED",
      "FEMALE_GENITALIA_EXPOSED",
      "MALE_GENITALIA_EXPOSED",
      "MALE_BREAST_EXPOSED",
      "BUTTOCKS_EXPOSED",
      "ANUS_EXPOSED",
    ],
  },
  {
    label: "Covered",
    labels: [
      "FEMALE_BREAST_COVERED",
      "FEMALE_GENITALIA_COVERED",
      "MALE_GENITALIA_COVERED",
      "BUTTOCKS_COVERED",
      "ANUS_COVERED",
    ],
  },
  {
    label: "Other",
    labels: [
      "BELLY_EXPOSED",
      "BELLY_COVERED",
      "ARMPITS_EXPOSED",
      "ARMPITS_COVERED",
      "FEET_EXPOSED",
      "FEET_COVERED",
      "FACE_FEMALE",
      "FACE_MALE",
    ],
  },
];

function labelField(label: string, group: string): FieldDef<ImageFile> {
  return {
    key: `label:${label}`,
    label,
    category: "label",
    group,
    valueType: "percent",
    operators: ["gte", "lt"],
    defaultOperator: "gte",
    defaultValue: 70,
    test: (row, operator, value) => {
      const threshold = (value as number) / 100;
      const match = row.detections.find((d) => d.label === label);
      const confidence = match?.confidence ?? 0;
      return operator === "gte" ? confidence >= threshold : confidence < threshold;
    },
  };
}

const DATE_UNIT_SECONDS: Record<string, number> = {
  days: 86400,
  weeks: 604800,
  months: 2592000,
};

const generalFields: FieldDef<ImageFile>[] = [
  {
    key: "size",
    label: "File size",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "gt",
    defaultValue: 5,
    unitLabel: "MB",
    presets: [
      { label: "1 MB", value: 1 },
      { label: "5 MB", value: 5 },
      { label: "20 MB", value: 20 },
      { label: "50 MB", value: 50 },
    ],
    test: (row, operator, value) => {
      const mb = row.size / (1024 * 1024);
      const v = value as number;
      return operator === "gt" ? mb > v : mb < v;
    },
  },
  {
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
      if (row.width == null || row.height == null) return false;
      const orientation =
        row.width === row.height ? "square" : row.width > row.height ? "landscape" : "portrait";
      return orientation === value;
    },
  },
  {
    key: "file_added",
    label: "File added",
    category: "numeric",
    valueType: "date_offset",
    operators: ["gt", "lt"], // gt = after, lt = before
    defaultOperator: "lt",
    defaultValue: { n: 30, unit: "days" },
    test: (row, operator, value) => {
      if (row.file_mtime == null) return false;
      const v = value as { n: number; unit: string };
      const cutoff = Date.now() / 1000 - v.n * (DATE_UNIT_SECONDS[v.unit] ?? 86400);
      return operator === "gt" ? row.file_mtime > cutoff : row.file_mtime < cutoff;
    },
  },
  {
    key: "no_detections",
    label: "No detections at all",
    category: "label",
    group: "Quick filters",
    valueType: "boolean",
    operators: ["eq"],
    defaultOperator: "eq",
    defaultValue: true,
    test: (row) => row.detections.length === 0,
  },
];

export const contentReviewFields: FieldDef<ImageFile>[] = [
  ...generalFields,
  ...LABEL_GROUPS.flatMap((g) => g.labels.map((label) => labelField(label, g.label))),
];
