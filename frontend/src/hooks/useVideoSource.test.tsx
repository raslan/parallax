// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { useVideoSource } from "@/hooks/useVideoSource";
import type { StreamPrepareStatus } from "@/types/stream";

const direct: StreamPrepareStatus = {
  status: "ready",
  progress: 100,
  error: null,
  mode: "direct",
  url: null,
};

afterEach(cleanup);

describe("useVideoSource", () => {
  it("reports ready for a direct file", async () => {
    const prepareFn = vi.fn().mockResolvedValue(direct);
    const statusFn = vi.fn();
    const { result } = renderHook(() =>
      useVideoSource({ path: "/r/a.mkv", streamUrl: "/stream/a", prepareFn, statusFn }),
    );
    expect(result.current.status).toBe("checking");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.hlsUrl).toBeNull();
    expect(result.current.src).toBe("/stream/a");
    expect(prepareFn).toHaveBeenCalledWith("/r/a.mkv");
  });

  it("switches to hls when prepare returns hls", async () => {
    const prepareFn = vi
      .fn()
      .mockResolvedValue({ ...direct, mode: "hls", url: "/stream/hls/a.m3u8" });
    const { result } = renderHook(() =>
      useVideoSource({ path: "/r/a.mkv", streamUrl: "/stream/a", prepareFn, statusFn: vi.fn() }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.hlsUrl).toContain("/stream/hls/a.m3u8");
    expect(result.current.src).toBe(result.current.hlsUrl);
  });

  it("stops polling and reports the error after repeated status failures", async () => {
    vi.useFakeTimers();
    try {
      const prepareFn = vi.fn().mockResolvedValue({ ...direct, status: "running", progress: 0 });
      const statusFn = vi.fn().mockRejectedValue(new Error("502: bad gateway"));
      const { result } = renderHook(() =>
        useVideoSource({ path: "/r/a.mkv", streamUrl: "/stream/a", prepareFn, statusFn }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500 * 5 + 100);
      });
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe("502: bad gateway");
      const calls = statusFn.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500 * 5);
      });
      expect(statusFn.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});
