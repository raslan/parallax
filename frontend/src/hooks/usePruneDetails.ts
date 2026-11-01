import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { FileDetails, PruneFile } from "@/types/prune";

const BATCH_SIZE = 25;
const IN_FLIGHT = 2;

interface State {
  /** The `files` array these results belong to; anything else is stale. */
  source: PruneFile[] | null;
  details: Record<string, FileDetails | null>;
  loaded: number;
}

const EMPTY: Record<string, FileDetails | null> = {};

/**
 * Streams ffprobe details for a folder's files in the background: batches of 25
 * paths, 2 requests in flight, results merged as they land so the UI never waits.
 * A failed batch (e.g. one unreadable path) marks just its files as `null` and
 * the rest carry on. Switching folder (or unmounting) stops further requests and
 * discards late results. `files` must be referentially stable (query data).
 */
export function usePruneDetails(folderPath: string, files: PruneFile[]) {
  const [state, setState] = useState<State>({ source: null, details: EMPTY, loaded: 0 });

  useEffect(() => {
    if (files.length === 0) return;
    let cancelled = false;
    const paths = files.map((f) => f.path);
    const batches: string[][] = [];
    for (let i = 0; i < paths.length; i += BATCH_SIZE) batches.push(paths.slice(i, i + BATCH_SIZE));
    let next = 0;

    async function worker() {
      while (!cancelled && next < batches.length) {
        const batch = batches[next++]!;
        let got: Record<string, FileDetails | null> = {};
        try {
          got = (await api.getPruneDetails(batch)).details;
        } catch {
          // Whole batch failed: fall through with every path marked null.
        }
        if (cancelled) return;
        setState((prev) => {
          const base = prev.source === files ? prev : { source: files, details: EMPTY, loaded: 0 };
          const merged = { ...base.details };
          for (const p of batch) merged[p] = got[p] ?? null;
          return { source: files, details: merged, loaded: base.loaded + batch.length };
        });
      }
    }

    for (let i = 0; i < IN_FLIGHT; i++) void worker();
    return () => {
      cancelled = true;
    };
  }, [folderPath, files]);

  const fresh = state.source === files;
  const total = files.length;
  const loaded = fresh ? state.loaded : 0;
  return {
    details: fresh ? state.details : EMPTY,
    loaded,
    total,
    done: total === 0 || loaded >= total,
  };
}
