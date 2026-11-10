import { useEffect, useMemo, useRef, useState } from "react";
import type { OrganizeFile } from "@/types/organize";

const BATCH_SIZE = 25;
const IN_FLIGHT = 2;

/** A result is reused only while the file's path, size and mtime are unchanged. */
const keyOf = (f: OrganizeFile) => `${f.path}\u0000${f.size}\u0000${f.mtime}`;

/**
 * Streams a per-file lookup (ffprobe details, embedded tags) for a folder's files in the
 * background: batches of 25 paths, 2 requests in flight, results merged as they land so
 * the UI never waits. A failed batch (e.g. one unreadable path) marks just its files
 * `null` and the rest carry on. Results are cached by path + size + mtime, so a refetch
 * of the same folder (e.g. after a delete) keeps every unchanged file's result and only
 * looks up new or changed files; the cache is trimmed to the current list. Switching
 * folder (a new `resetKey`) or unmounting stops further requests and discards late
 * results. While `enabled` is false nothing is requested.
 *
 * `files` must be referentially stable (query data) and `fetchBatch` a stable function.
 */
export function useStreamedByFile<T>({
  resetKey,
  files,
  enabled,
  fetchBatch,
}: {
  resetKey: string;
  files: OrganizeFile[];
  enabled: boolean;
  fetchBatch: (paths: string[]) => Promise<Record<string, T | null>>;
}) {
  const [cache, setCache] = useState<Record<string, T | null>>({});
  // Read by the fetch effect without re-running it on every merged batch.
  const cacheRef = useRef(cache);
  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    if (!enabled || files.length === 0) return;
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
        let got: Record<string, T | null> = {};
        try {
          got = await fetchBatch(batch.map((f) => f.path));
        } catch {
          // Whole batch failed: fall through with every path marked null.
        }
        if (cancelled) return;
        setCache((prev) => {
          const merged: Record<string, T | null> = {};
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
  }, [resetKey, files, enabled, fetchBatch]);

  const { byPath, loaded } = useMemo(() => {
    const out: Record<string, T | null> = {};
    let n = 0;
    for (const f of files) {
      const k = keyOf(f);
      if (k in cache) {
        out[f.path] = cache[k] ?? null;
        n++;
      }
    }
    return { byPath: out, loaded: n };
  }, [files, cache]);

  const total = files.length;
  return { byPath, loaded, total, done: total === 0 || loaded >= total };
}
