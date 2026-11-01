// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDetails, PruneFile } from "@/types/prune";

const getPruneDetails = vi.fn();
vi.mock("@/lib/api", () => ({ api: { getPruneDetails: (p: string[]) => getPruneDetails(p) } }));

import { usePruneDetails } from "./usePruneDetails";

const mkFiles = (n: number): PruneFile[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `f${i}`,
    path: `/r/f${i}`,
    kind: "video",
    size: 1,
    mtime: 0,
  }));

const info = (w: number): FileDetails => ({
  duration: 1,
  width: w,
  height: w,
  codec: "h264",
  bitrate: 1,
});

/** A deferred api call so a test can hold batches in flight. */
function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  // Braces matter: a returned mock would be run by vitest as a teardown hook.
  getPruneDetails.mockReset();
});
afterEach(cleanup);

describe("usePruneDetails", () => {
  it("requests batches of 25 and reports done with merged details", async () => {
    getPruneDetails.mockImplementation(async (paths: string[]) => ({
      details: Object.fromEntries(paths.map((p) => [p, info(1)])),
    }));
    const files = mkFiles(60);
    const { result } = renderHook(() => usePruneDetails("/r", files));
    await waitFor(() => expect(result.current.done).toBe(true));
    const sizes = getPruneDetails.mock.calls.map((c) => (c[0] as string[]).length).sort();
    expect(sizes).toEqual([10, 25, 25]);
    expect(result.current.loaded).toBe(60);
    expect(result.current.total).toBe(60);
    expect(result.current.details["/r/f59"]).toEqual(info(1));
  });

  it("keeps at most 2 batches in flight", async () => {
    const gates = [deferred(), deferred(), deferred()];
    let call = 0;
    getPruneDetails.mockImplementation(() => gates[call++]!.promise);
    const files = mkFiles(75);
    const { result } = renderHook(() => usePruneDetails("/r", files));
    await waitFor(() => expect(getPruneDetails).toHaveBeenCalledTimes(2));
    expect(result.current.done).toBe(false);
    gates[0]!.resolve({ details: {} });
    await waitFor(() => expect(getPruneDetails).toHaveBeenCalledTimes(3));
    gates[1]!.resolve({ details: {} });
    gates[2]!.resolve({ details: {} });
    await waitFor(() => expect(result.current.done).toBe(true));
  });

  it("stops requesting after unmount", async () => {
    const gate = deferred();
    getPruneDetails.mockImplementation(() => gate.promise);
    const { unmount } = renderHook(() => usePruneDetails("/r", mkFiles(200)));
    await waitFor(() => expect(getPruneDetails).toHaveBeenCalledTimes(2));
    unmount();
    gate.resolve({ details: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(getPruneDetails).toHaveBeenCalledTimes(2);
  });

  it("drops stale results and restarts when the folder changes", async () => {
    const gate = deferred();
    getPruneDetails.mockImplementationOnce(() => gate.promise);
    getPruneDetails.mockImplementation(async (paths: string[]) => ({
      details: Object.fromEntries(paths.map((p) => [p, info(2)])),
    }));
    const a = mkFiles(3);
    const b = [{ ...mkFiles(1)[0]!, path: "/s/x" }];
    const { result, rerender } = renderHook(({ p, f }) => usePruneDetails(p, f), {
      initialProps: { p: "/r", f: a },
    });
    rerender({ p: "/s", f: b });
    await waitFor(() => expect(result.current.done).toBe(true));
    gate.resolve({ details: { "/r/f0": info(9) } });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.details["/r/f0"]).toBeUndefined();
    expect(result.current.details["/s/x"]).toEqual(info(2));
    expect(result.current.total).toBe(1);
  });

  it("marks a failed batch as null and keeps going", async () => {
    getPruneDetails.mockImplementation(async (paths: string[]) => {
      if (paths[0] === "/r/f0") throw new Error("403");
      return { details: Object.fromEntries(paths.map((p) => [p, info(1)])) };
    });
    const files = mkFiles(30);
    const { result } = renderHook(() => usePruneDetails("/r", files));
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.details["/r/f3"]).toBeNull();
    expect(result.current.details["/r/f28"]).toEqual(info(1));
    expect(result.current.loaded).toBe(30);
  });

  it("keeps loaded details across a refetch and only probes changed files", async () => {
    getPruneDetails.mockImplementation(async (paths: string[]) => ({
      details: Object.fromEntries(paths.map((p) => [p, info(1)])),
    }));
    const a = mkFiles(4);
    const { result, rerender } = renderHook(({ f }) => usePruneDetails("/r", f), {
      initialProps: { f: a },
    });
    await waitFor(() => expect(result.current.done).toBe(true));
    getPruneDetails.mockClear();
    // Refetch after a partly failed delete: f0 is gone, f3 was rewritten (new mtime).
    const b = [a[1]!, a[2]!, { ...a[3]!, mtime: 5 }].map((f) => ({ ...f }));
    rerender({ f: b });
    expect(result.current.details["/r/f1"]).toEqual(info(1)); // no reset to empty
    expect(result.current.details["/r/f3"]).toBeUndefined(); // stale size/mtime is not reused
    expect(result.current.loaded).toBe(2);
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(getPruneDetails.mock.calls.map((c) => c[0])).toEqual([["/r/f3"]]);
    expect(result.current.details["/r/f0"]).toBeUndefined();
    expect(result.current.total).toBe(3);
  });

  it("is done immediately for an empty folder", () => {
    const { result } = renderHook(() => usePruneDetails("/r", []));
    expect(result.current.done).toBe(true);
    expect(getPruneDetails).not.toHaveBeenCalled();
  });
});
