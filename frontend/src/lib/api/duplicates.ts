import { req } from "./client";
import type { DuplicateCriteria, DuplicateGroup } from "@/types/duplicate";

export const duplicatesApi = {
  findDuplicates: (id: number, criteria: DuplicateCriteria) =>
    req<{ message: string }>(`/libraries/${id}/find-duplicates`, {
      method: "POST",
      body: JSON.stringify(criteria),
    }),
  getDuplicates: (id: number) => req<DuplicateGroup[]>(`/libraries/${id}/duplicates`),
  deleteDuplicates: (id: number, file_ids: number[]) =>
    req<void>(`/libraries/${id}/duplicates`, {
      method: "DELETE",
      body: JSON.stringify({ file_ids }),
    }),
};
