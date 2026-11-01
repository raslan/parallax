import { describe, it, expect, vi } from "vitest";
import { DELETE_CHUNK, deleteInChunks, mergeDeleteResults } from "./pruneDelete";
import type { PruneDeleteResult } from "@/types/prune";

const ok = (paths: string[], empty: string[] = []): PruneDeleteResult => ({
  deleted: paths,
  failed: [],
  empty_folders: empty,
});

describe("mergeDeleteResults", () => {
  it("concatenates and de-duplicates every list", () => {
    const merged = mergeDeleteResults([
      { deleted: ["a"], failed: [{ path: "x", error: "e" }], empty_folders: ["/d"] },
      { deleted: ["a", "b"], failed: [{ path: "x", error: "e2" }], empty_folders: ["/d", "/e"] },
    ]);
    expect(merged).toEqual({
      deleted: ["a", "b"],
      failed: [{ path: "x", error: "e" }],
      empty_folders: ["/d", "/e"],
    });
  });
});

describe("deleteInChunks", () => {
  const paths = Array.from({ length: 1200 }, (_, i) => `/r/${i}`);

  it("sends chunks of 500 one after another and merges the results", async () => {
    const call = vi.fn(async (chunk: string[]) => ok(chunk, ["/r"]));
    const progress = vi.fn();
    const { result, error } = await deleteInChunks(paths, call, progress);
    expect(DELETE_CHUNK).toBe(500);
    expect(call.mock.calls.map((c) => c[0].length)).toEqual([500, 500, 200]);
    expect(result.deleted).toHaveLength(1200);
    expect(result.empty_folders).toEqual(["/r"]);
    expect(error).toBeNull();
    expect(progress.mock.calls.map((c) => c[0])).toEqual([500, 1000, 1200]);
  });

  it("stops at the first failed chunk and keeps what already went", async () => {
    const call = vi
      .fn()
      .mockImplementationOnce(async (chunk: string[]) => ok(chunk))
      .mockRejectedValueOnce(new Error("409: Folder is no longer available"));
    const { result, error } = await deleteInChunks(paths, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.deleted).toHaveLength(500);
    expect(String(error)).toContain("409");
  });

  it("makes no call for an empty list", async () => {
    const call = vi.fn();
    const { result } = await deleteInChunks([], call);
    expect(call).not.toHaveBeenCalled();
    expect(result).toEqual(ok([]));
  });
});
