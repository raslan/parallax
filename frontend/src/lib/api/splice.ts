import { req } from "./client";
import { compressApi } from "./compress";
import type { SpliceMergeRequest, SplicePreflight, SplicePreflightRequest } from "@/types/splice";

export const spliceApi = {
  libraryFiles: compressApi.libraryFiles,
  preflight: (body: SplicePreflightRequest) =>
    req<SplicePreflight>("/splice/preflight", { method: "POST", body: JSON.stringify(body) }),
  merge: (body: SpliceMergeRequest) =>
    req<{ job_id: number }>("/splice/merge", { method: "POST", body: JSON.stringify(body) }),
  retryCpu: (jobId: number) =>
    req<{ job_id: number }>(`/splice/jobs/${jobId}/retry-cpu`, { method: "POST" }),
};
