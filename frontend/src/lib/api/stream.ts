import { req } from "./client";
import type { StreamPrepareStatus } from "@/types/stream";

export const streamApi = {
  prepare: (path: string) =>
    req<StreamPrepareStatus>("/stream/prepare", { method: "POST", body: JSON.stringify({ path }) }),
  status: (path: string) =>
    req<StreamPrepareStatus>(`/stream/prepare-status?path=${encodeURIComponent(path)}`),
};
