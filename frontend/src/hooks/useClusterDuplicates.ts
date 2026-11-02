import { useMemo } from "react";
import { useWorkerRequest } from "@/hooks/useWorkerRequest";
import type { DuplicateCriteria } from "@/types/duplicate";
import type { VideoFile } from "@/types/file";
import type { ClusterRequest, ClusterResponse, DuplicateGroup } from "@/lib/clusterDuplicates";

const EMPTY_GROUPS: DuplicateGroup[] = [];

const createWorker = () =>
  new Worker(new URL("../lib/clusterDuplicates.worker.ts", import.meta.url), { type: "module" });

/**
 * Runs clusterDuplicates() in a Web Worker instead of a useMemo — the
 * pairwise pHash/audio stages are O(n^2) per group with BigInt Hamming
 * distance, which on a large library can be tens of millions of operations
 * and froze the tab for multiple seconds on every criteria toggle when run
 * synchronously on the main thread. Stale responses (a criteria change that
 * fires before the previous computation finishes) are dropped via a
 * request-id check (`useWorkerRequest`).
 */
export function useClusterDuplicates(files: VideoFile[], criteria: DuplicateCriteria) {
  const request = useMemo(() => ({ files, criteria }), [files, criteria]);
  const { response, pending } = useWorkerRequest<ClusterRequest, ClusterResponse>(
    createWorker,
    request,
    { initialPending: false },
  );
  return { groups: response?.groups ?? EMPTY_GROUPS, isComputing: pending };
}
