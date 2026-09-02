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

export const contentReviewFields: FieldDef<ImageFile>[] = [
  ...LABEL_GROUPS.flatMap((g) => g.labels.map((label) => labelField(label, g.label))),
];
