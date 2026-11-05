import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { FileDetails, OrganizeFile } from "@/types/organize";

const BATCH_SIZE = 25;
const IN_FLIGHT = 2;

type Cache = Record<string, FileDetails | null>;

/** Details are reused only while the file's path, size and mtime are unchanged. */
const keyOf = (f: OrganizeFile) => `${f.path}\u0000${f.size}\u0000${f.mtime}`;

/**
 * Streams ffprobe details for a folder's files in the background: batches of 25
 * paths, 2 requests in flight, results merged as they land so the UI never waits.
 * A failed batch (e.g. one unreadable path) marks just its files as `null` and
 * the rest carry on. Results are cached by path + size + mtime, so a refetch of
 * the same folder (e.g. after a delete) keeps every unchanged file's details and
 * only probes new or changed files; the cache is trimmed to the current list.
 * Switching folder (or unmounting) stops further requests and discards late
 * results. `files` must be referentially stable (query data).
 */
export function useOrganizeDetails(folderPath: string, files: OrganizeFile[]) {
  const [cache, setCache] = useState<Cache>({});
  // Read by the fetch effect without re-running it on every merged batch.
  const cacheRef = useRef(cache);
  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    if (files.length === 0) return;
    let cancelled = false;
    const known = cacheRef.current;
    const live = new Set(files.map(keyOf));
    const todo = files.filter((f) => !(keyOf(f) in known));
    const batches: OrganizeFile[][] = [];
    for (let i = 0; i < todo.length; i += BATCH_SIZE) batches.push(todo.slice(i, i + BATCH_SIZE));
    let next = 0;

    async function worker() {
      while (!cancelled && next < batches.length) {
        const batch = batches[next++]!;
        let got: Record<string, FileDetails | null> = {};
        try {
          got = (await api.getOrganizeDetails(batch.map((f) => f.path))).details;
        } catch {
          // Whole batch failed: fall through with every path marked null.
        }
        if (cancelled) return;
        setCache((prev) => {
          const merged: Cache = {};
          for (const k in prev) if (live.has(k)) merged[k] = prev[k] ?? null;
          for (const f of batch) merged[keyOf(f)] = got[f.path] ?? null;
          return merged;
        });
      }
    }

    for (let i = 0; i < IN_FLIGHT; i++) void worker();
    return () => {
      cancelled = true;
    };
  }, [folderPath, files]);

  const { details, loaded } = useMemo(() => {
    const out: Record<string, FileDetails | null> = {};
    let n = 0;
    for (const f of files) {
      const k = keyOf(f);
      if (k in cache) {
        out[f.path] = cache[k] ?? null;
        n++;
      }
    }
    return { details: out, loaded: n };
  }, [files, cache]);

  const total = files.length;
  return { details, loaded, total, done: total === 0 || loaded >= total };
}
