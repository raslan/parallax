import { useEffect, useRef, useState } from "react";
import type { NameGroup, NameGroupsRequest, NameGroupsResponse } from "@/lib/nameGroups";

const NONE: NameGroup[] = [];

/**
 * Runs `detectNameGroups` in a module worker (same plumbing as `useClusterDuplicates`)
 * so a big folder of long names never blocks the main thread. `pending` is true from
 * a names change until the matching answer arrives; answers for an older request are
 * dropped. Previous groups stay visible while a new run is pending. Pass a
 * referentially stable `names` array.
 */
export function useNameGroups(names: string[]) {
  const [groups, setGroups] = useState<NameGroup[]>(NONE);
  const [pending, setPending] = useState(true);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL("../lib/nameGroups.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<NameGroupsResponse>) => {
      if (event.data.requestId !== requestIdRef.current) return; // stale
      setGroups(event.data.groups);
      setPending(false);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = ++requestIdRef.current;
    setPending(true);
    const message: NameGroupsRequest = { requestId, names };
    worker.postMessage(message);
  }, [names]);

  return { groups, pending };
}
