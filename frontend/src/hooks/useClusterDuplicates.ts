import { useEffect, useRef, useState } from "react";
import type { DuplicateCriteria } from "@/types/duplicate";
import type { VideoFile } from "@/types/file";
import type { ClusterRequest, ClusterResponse, DuplicateGroup } from "@/lib/clusterDuplicates";

const EMPTY_GROUPS: DuplicateGroup[] = [];

/**
 * Runs clusterDuplicates() in a Web Worker instead of a useMemo — the
 * pairwise pHash/audio stages are O(n^2) per group with BigInt Hamming
 * distance, which on a large library can be tens of millions of operations
 * and froze the tab for multiple seconds on every criteria toggle when run
 * synchronously on the main thread. Stale responses (a criteria change that
 * fires before the previous computation finishes) are dropped via a
 * request-id check.
 */
export function useClusterDuplicates(files: VideoFile[], criteria: DuplicateCriteria) {
  const [groups, setGroups] = useState<DuplicateGroup[]>(EMPTY_GROUPS);
  const [isComputing, setIsComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL("../lib/clusterDuplicates.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<ClusterResponse>) => {
      if (event.data.requestId !== requestIdRef.current) return; // stale, a newer request is in flight
      setGroups(event.data.groups);
      setIsComputing(false);
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = ++requestIdRef.current;
    setIsComputing(true);
    const message: ClusterRequest = { requestId, files, criteria };
    worker.postMessage(message);
  }, [files, criteria]);

  return { groups, isComputing };
}
