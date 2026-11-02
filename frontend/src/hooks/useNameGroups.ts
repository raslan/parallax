import { useMemo } from "react";
import { useWorkerRequest } from "@/hooks/useWorkerRequest";
import type { NameGroup, NameGroupsRequest, NameGroupsResponse } from "@/lib/nameGroups";

const NONE: NameGroup[] = [];

const createWorker = () =>
  new Worker(new URL("../lib/nameGroups.worker.ts", import.meta.url), { type: "module" });

/**
 * Runs `detectNameGroups` in a module worker (`useWorkerRequest`, shared with
 * `useClusterDuplicates`) so a big folder of long names never blocks the main thread.
 * `pending` is true from a names change until the matching answer arrives; answers for
 * an older request are dropped. Previous groups stay visible while a new run is
 * pending. Pass a referentially stable `names` array.
 */
export function useNameGroups(names: string[]) {
  const request = useMemo(() => ({ names }), [names]);
  const { response, pending } = useWorkerRequest<NameGroupsRequest, NameGroupsResponse>(
    createWorker,
    request,
  );
  return { groups: response?.groups ?? NONE, pending };
}
