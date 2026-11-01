import type { PruneDeleteResult } from "@/types/prune";

/** Paths per `POST /prune/delete` call (the backend caps one request at 5000). */
export const DELETE_CHUNK = 500;

/** Merge per-chunk results; every list is de-duplicated (first occurrence wins). */
export function mergeDeleteResults(results: readonly PruneDeleteResult[]): PruneDeleteResult {
  const deleted = new Set<string>();
  const failed = new Map<string, PruneDeleteResult["failed"][number]>();
  const empty = new Set<string>();
  for (const r of results) {
    for (const p of r.deleted) deleted.add(p);
    for (const f of r.failed) if (!failed.has(f.path)) failed.set(f.path, f);
    for (const p of r.empty_folders) empty.add(p);
  }
  return { deleted: [...deleted], failed: [...failed.values()], empty_folders: [...empty] };
}

/**
 * Delete `paths` in sequential chunks of 500. Stops at the first chunk that
 * throws (e.g. a 409 when the root vanished) and returns what was already
 * deleted alongside that error, so nothing done so far goes unreported.
 * `onProgress(done)` fires after each chunk with the number of paths sent.
 */
export async function deleteInChunks(
  paths: readonly string[],
  call: (chunk: string[]) => Promise<PruneDeleteResult>,
  onProgress?: (done: number) => void,
): Promise<{ result: PruneDeleteResult; error: unknown }> {
  const results: PruneDeleteResult[] = [];
  let error: unknown = null;
  for (let i = 0; i < paths.length; i += DELETE_CHUNK) {
    const chunk = paths.slice(i, i + DELETE_CHUNK);
    try {
      results.push(await call(chunk));
    } catch (e) {
      error = e;
      break;
    }
    onProgress?.(i + chunk.length);
  }
  return { result: mergeDeleteResults(results), error };
}
