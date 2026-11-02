// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useWorkerRequest } from "./useWorkerRequest";

type Req = { requestId: number; n: number };
type Res = { requestId: number; doubled: number };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: Req[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(m: Req) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(requestId: number, doubled: number) {
    this.onmessage?.({ data: { requestId, doubled } } as MessageEvent);
  }
}

const make = () => new FakeWorker() as unknown as Worker;

beforeEach(() => {
  FakeWorker.instances = [];
});
afterEach(cleanup);

describe("useWorkerRequest", () => {
  it("creates one worker, posts the request with an id and returns the answer", () => {
    const req = { n: 2 };
    const { result, rerender } = renderHook(() => useWorkerRequest<Req, Res>(make, req));
    expect(FakeWorker.instances).toHaveLength(1);
    const w = FakeWorker.instances[0]!;
    expect(w.posted).toEqual([{ requestId: 1, n: 2 }]);
    expect(result.current).toEqual({ response: null, pending: true });
    act(() => w.reply(1, 4));
    expect(result.current).toEqual({ response: { requestId: 1, doubled: 4 }, pending: false });
    rerender();
    // Same request identity: no new worker, no new post.
    expect(FakeWorker.instances).toHaveLength(1);
    expect(w.posted).toHaveLength(1);
  });

  it("drops a stale answer and keeps the previous response while a new one is pending", () => {
    const { result, rerender } = renderHook(({ r }) => useWorkerRequest<Req, Res>(make, r), {
      initialProps: { r: { n: 1 } },
    });
    const w = FakeWorker.instances[0]!;
    act(() => w.reply(1, 2));
    rerender({ r: { n: 5 } });
    rerender({ r: { n: 6 } });
    expect(w.posted.map((p) => p.requestId)).toEqual([1, 2, 3]);
    act(() => w.reply(2, 10)); // stale
    expect(result.current).toEqual({ response: { requestId: 1, doubled: 2 }, pending: true });
    act(() => w.reply(3, 12));
    expect(result.current).toEqual({ response: { requestId: 3, doubled: 12 }, pending: false });
  });

  it("takes the first render's pending flag from initialPending", () => {
    const req = { n: 1 };
    const seen: boolean[] = [];
    renderHook(() => {
      const r = useWorkerRequest<Req, Res>(make, req, { initialPending: false });
      seen.push(r.pending);
      return r;
    });
    // First render as asked; the post on mount then flips it to pending.
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
    const seenDefault: boolean[] = [];
    renderHook(() => {
      const r = useWorkerRequest<Req, Res>(make, req);
      seenDefault.push(r.pending);
      return r;
    });
    expect(seenDefault[0]).toBe(true);
  });

  it("terminates the worker on unmount", () => {
    const { unmount } = renderHook(() => useWorkerRequest<Req, Res>(make, { n: 1 }));
    unmount();
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
  });
});
