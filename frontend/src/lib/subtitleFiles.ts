import type { SubtitleFile } from "@/types/subtitle";

/** True when the video has any subtitle for a wanted language, real or machine-made. A
 *  machine-made file is one the user chose to make, so it can be previewed and synced. */
export function hasAnySubtitle(file: Pick<SubtitleFile, "languages" | "machine_languages">) {
  return (
    Object.values(file.languages).some(Boolean) ||
    Object.values(file.machine_languages ?? {}).some(Boolean)
  );
}
