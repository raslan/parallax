// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

const getOrganizeTags = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { getOrganizeTags: (p: string[], full?: boolean) => getOrganizeTags(p, full) },
}));

import { useOrganizeTags } from "./useOrganizeTags";

const mkFiles = (n: number): OrganizeFile[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `f${i}`,
    path: `/r/f${i}`,
    kind: "audio",
    size: 1,
    mtime: 0,
  }));

const info = (title: string): OrganizeTagInfo => ({
  fields: { title },
  raw: { title },
  streams: [],
  truncated: false,
});

function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  getOrganizeTags.mockReset();
});
afterEach(cleanup);

describe("useOrganizeTags", () => {
  it("makes no request while disabled, however many files there are", async () => {
    const files = mkFiles(1000);
    renderHook(() => useOrganizeTags("/r", files, false));
    await new Promise((r) => setTimeout(r, 20));
    expect(getOrganizeTags).not.toHaveBeenCalled();
  });

  it("fetches batches of 25 with at most two in flight, then reports done", async () => {
    const gates = [deferred(), deferred(), deferred()];
    let call = 0;
    getOrganizeTags.mockImplementation((paths: string[]) => {
      const gate = gates[call++]!;
      return gate.promise.then(() => ({
        tags: Object.fromEntries(paths.map((p) => [p, info(p)])),
      }));
    });
    const files = mkFiles(60);
    const { result } = renderHook(() => useOrganizeTags("/r", files, true));
    await waitFor(() => expect(getOrganizeTags).toHaveBeenCalledTimes(2));
    expect(getOrganizeTags.mock.calls.map(([p]) => p.length)).toEqual([25, 25]);
    expect(getOrganizeTags.mock.calls.every(([, full]) => !full)).toBe(true);
    gates[0]!.resolve(undefined);
    await waitFor(() => expect(getOrganizeTags).toHaveBeenCalledTimes(3));
    expect(getOrganizeTags.mock.calls[2]![0]).toHaveLength(10);
    gates[1]!.resolve(undefined);
    gates[2]!.resolve(undefined);
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.loaded).toBe(60);
    expect(result.current.tags["/r/f3"]?.fields.title).toBe("/r/f3");
  });

  it("starts fetching once enabled flips on", async () => {
    getOrganizeTags.mockImplementation(async (paths: string[]) => ({
      tags: Object.fromEntries(paths.map((p) => [p, info("t")])),
    }));
    const files = mkFiles(3);
    const { result, rerender } = renderHook(({ on }) => useOrganizeTags("/r", files, on), {
      initialProps: { on: false },
    });
    expect(getOrganizeTags).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(getOrganizeTags).toHaveBeenCalledTimes(1);
  });

  it("a failed batch leaves its files null and the rest still load", async () => {
    getOrganizeTags.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    getOrganizeTags.mockImplementation(async (paths: string[]) => ({
      tags: Object.fromEntries(paths.map((p) => [p, info("ok")])),
    }));
    const files = mkFiles(30);
    const { result } = renderHook(() => useOrganizeTags("/r", files, true));
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.tags["/r/f0"]).toBeNull();
    expect(result.current.tags["/r/f29"]?.fields.title).toBe("ok");
  });

  it("a refetch with unchanged files makes no new calls", async () => {
    getOrganizeTags.mockImplementation(async (paths: string[]) => ({
      tags: Object.fromEntries(paths.map((p) => [p, info("t")])),
    }));
    const files = mkFiles(5);
    const { result, rerender } = renderHook(({ f }) => useOrganizeTags("/r", f, true), {
      initialProps: { f: files },
    });
    await waitFor(() => expect(result.current.done).toBe(true));
    rerender({ f: mkFiles(5) }); // new array identity, same path + size + mtime
    await new Promise((r) => setTimeout(r, 20));
    expect(getOrganizeTags).toHaveBeenCalledTimes(1);
  });

  it("forget drops only the named files and reads them again, even at the same size and mtime", async () => {
    // An edit that restores the modification time and keeps the size would otherwise be
    // invisible to the path + size + mtime cache.
    let title = "before";
    getOrganizeTags.mockImplementation(async (paths: string[]) => ({
      tags: Object.fromEntries(paths.map((p) => [p, info(`${title}:${p}`)])),
    }));
    const files = mkFiles(3);
    const { result } = renderHook(() => useOrganizeTags("/r", files, true));
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(getOrganizeTags).toHaveBeenCalledTimes(1);
    title = "after!";
    act(() => result.current.forget(["/r/f1"]));
    await waitFor(() => expect(result.current.tags["/r/f1"]?.fields.title).toBe("after!:/r/f1"));
    expect(getOrganizeTags).toHaveBeenCalledTimes(2);
    expect(getOrganizeTags.mock.calls[1]![0]).toEqual(["/r/f1"]);
    expect(result.current.tags["/r/f0"]?.fields.title).toBe("before:/r/f0");
  });

  it("forget with nothing to forget makes no request", async () => {
    getOrganizeTags.mockImplementation(async (paths: string[]) => ({
      tags: Object.fromEntries(paths.map((p) => [p, info("t")])),
    }));
    const files = mkFiles(2);
    const { result } = renderHook(() => useOrganizeTags("/r", files, true));
    await waitFor(() => expect(result.current.done).toBe(true));
    act(() => result.current.forget(["/elsewhere/x"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(getOrganizeTags).toHaveBeenCalledTimes(1);
  });
});
