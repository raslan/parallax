import { req } from "./client";
import type { DuplicateCriteria } from "@/types/duplicate";
import type { VideoFile } from "@/types/file";

export const duplicatesApi = {
  findDuplicates: (id: number, criteria: DuplicateCriteria) =>
    req<{ job_id: number; message: string }>(`/libraries/${id}/find-duplicates`, {
      method: "POST",
      body: JSON.stringify(criteria),
    }),
  getDuplicateFiles: (id: number) => req<VideoFile[]>(`/libraries/${id}/duplicate-files`),
  deleteDuplicates: (id: number, file_ids: number[]) =>
    req<void>(`/libraries/${id}/duplicates`, {
      method: "DELETE",
      body: JSON.stringify({ file_ids }),
    }),
};
