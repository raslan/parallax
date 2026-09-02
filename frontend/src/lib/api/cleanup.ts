import { req } from "./client";
import type { VideoFile } from "@/types/file";

export const cleanupApi = {
  getCleanupFiles: (id: number) => req<VideoFile[]>(`/libraries/${id}/cleanup`),
  deleteCleanupFiles: (id: number, file_ids: number[]) =>
    req<void>(`/libraries/${id}/cleanup`, { method: "DELETE", body: JSON.stringify({ file_ids }) }),
};
