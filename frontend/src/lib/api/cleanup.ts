import { req } from "./client";
import type { CleanupParams } from "@/types/cleanup";
import type { VideoFile } from "@/types/file";

function buildCleanupQuery(params: CleanupParams): string {
  const q = new URLSearchParams();
  if (params.duration_op) q.set("duration_op", params.duration_op);
  if (params.duration_secs !== undefined) q.set("duration_secs", String(params.duration_secs));
  if (params.fps_op) q.set("fps_op", params.fps_op);
  if (params.fps_val !== undefined) q.set("fps_val", String(params.fps_val));
  if (params.date_op) q.set("date_op", params.date_op);
  if (params.date_ts !== undefined) q.set("date_ts", String(params.date_ts));
  if (params.height_op) q.set("height_op", params.height_op);
  if (params.height_val !== undefined) q.set("height_val", String(params.height_val));
  return q.toString();
}

export const cleanupApi = {
  getCleanupFiles: (id: number, params: CleanupParams, fetchAll = false) => {
    const q = buildCleanupQuery(params);
    const qs = fetchAll ? (q ? `${q}&fetch_all=true` : "fetch_all=true") : q;
    return req<VideoFile[]>(`/libraries/${id}/cleanup?${qs}`);
  },
  deleteCleanupFiles: (id: number, file_ids: number[]) =>
    req<void>(`/libraries/${id}/cleanup`, { method: "DELETE", body: JSON.stringify({ file_ids }) }),
};
