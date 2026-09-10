import { req } from "./client";

export const audioDuplicatesApi = {
  findDuplicates: (libraryId: number) =>
    req<{ job_id: number; message: string }>(`/audio-libraries/${libraryId}/find-duplicates`, {
      method: "POST",
    }),
};
