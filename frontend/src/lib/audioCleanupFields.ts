import type { FieldDef } from "@/hooks/useQueryBuilder";
import type { AudioFile } from "@/types/audio";
import { dateField, durationField, filenameField, sizeField } from "@/lib/fileFieldFactories";

export const audioCleanupFields: FieldDef<AudioFile>[] = [
  durationField((r) => r.duration),
  dateField("date", "Content date", (r) => r.file_date),
  sizeField((r) => r.size, {
    defaultValue: 100,
    presets: [
      { label: "10 MB", value: 10 },
      { label: "50 MB", value: 50 },
      { label: "100 MB", value: 100 },
      { label: "500 MB", value: 500 },
    ],
  }),
  filenameField((r) => r.filename),
];
