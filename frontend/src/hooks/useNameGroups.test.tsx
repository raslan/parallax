// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useNameGroups } from "./useNameGroups";
import type { NameGroup, NameGroupsRequest } from "@/lib/nameGroups";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: NameGroupsRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(m: NameGroupsRequest) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(requestId: number, groups: NameGroup[]) {
    this.onmessage?.({ data: { requestId, groups } } as MessageEvent);
  }
}

const group = (text: string): NameGroup => ({ text, count: 5, children: [] });

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useNameGroups", () => {
  it("posts the names, is pending until the worker answers, then returns groups", () => {
    const names = ["a", "b"];
    const { result } = renderHook(() => useNameGroups(names));
    const w = FakeWorker.instances[0]!;
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]!.names).toBe(names);
    expect(result.current).toEqual({ groups: [], pending: true });
    act(() => w.reply(w.posted[0]!.requestId, [group("x")]));
    expect(result.current.pending).toBe(false);
    expect(result.current.groups.map((g) => g.text)).toEqual(["x"]);
  });

  it("ignores a stale answer when the names changed meanwhile", () => {
    const { result, rerender } = renderHook(({ n }) => useNameGroups(n), {
      initialProps: { n: ["a"] },
    });
    const w = FakeWorker.instances[0]!;
    const first = w.posted[0]!.requestId;
    rerender({ n: ["b"] });
    expect(w.posted).toHaveLength(2);
    act(() => w.reply(first, [group("stale")]));
    expect(result.current.pending).toBe(true);
    expect(result.current.groups).toEqual([]);
    act(() => w.reply(w.posted[1]!.requestId, [group("fresh")]));
    expect(result.current.groups.map((g) => g.text)).toEqual(["fresh"]);
    expect(result.current.pending).toBe(false);
  });

  it("terminates the worker on unmount", () => {
    const { unmount } = renderHook(() => useNameGroups(["a"]));
    unmount();
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
  });
});
