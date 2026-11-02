import type { FieldDef } from "@/hooks/useQueryBuilder";
import type { VideoFile } from "@/types/file";
import {
  dateField,
  durationField,
  filenameField,
  orientationField,
  resolutionField,
  sizeField,
} from "@/lib/fileFieldFactories";

export const cleanupFields: FieldDef<VideoFile>[] = [
  durationField((r) => r.duration),
  {
    key: "fps",
    label: "Framerate",
    category: "numeric",
    valueType: "number",
    operators: ["gt", "lt"],
    defaultOperator: "lt",
    defaultValue: 24,
    unitLabel: "fps",
    test: (row, operator, value) => {
      if (row.file_fps == null) return false;
      const v = value as number;
      return operator === "gt" ? row.file_fps > v : row.file_fps < v;
    },
  },
  dateField("date", "Content date", (r) => r.file_date),
  dateField("file_added", "File added", (r) => r.file_mtime),
  sizeField((r) => r.size, {
    defaultValue: 500,
    presets: [
      { label: "100 MB", value: 100 },
      { label: "500 MB", value: 500 },
      { label: "1 GB", value: 1000 },
      { label: "2 GB", value: 2000 },
    ],
  }),
  orientationField(
    (r) => r.file_width,
    (r) => r.file_height,
  ),
  resolutionField(
    (r) => r.file_width,
    (r) => r.file_height,
  ),
  filenameField((r) => r.filename),
];
