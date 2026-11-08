import { req } from "./client";
import type { AudioDuplicateCriteria } from "@/types/audioDuplicate";

export const audioDuplicatesApi = {
  findDuplicates: (libraryId: number, criteria: AudioDuplicateCriteria) =>
    req<{ job_id: number; message: string }>(`/audio-libraries/${libraryId}/find-duplicates`, {
      method: "POST",
      body: JSON.stringify(criteria),
    }),
};
