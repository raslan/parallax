// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", () => ({
  streamApi: { prepare: vi.fn(), status: vi.fn() },
}));
vi.mock("./VideoJsPlayer", () => ({ default: () => <div data-testid="player" /> }));
vi.mock("./VideoJsAudioPlayer", () => ({ default: () => <div data-testid="audio-player" /> }));

import { streamApi } from "@/lib/api";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import type { StreamPrepareStatus } from "@/types/stream";

const direct: StreamPrepareStatus = {
  status: "ready",
  progress: 100,
  error: null,
  mode: "direct",
  url: null,
};

const file = { id: 0, filename: "a.mkv", path: "/r/a.mkv" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(streamApi.prepare).mockResolvedValue(direct);
});
afterEach(cleanup);

describe("VideoPlayerModal prepare", () => {
  it("uses the library stream API by default", async () => {
    render(<VideoPlayerModal file={file} streamUrl="/x" onClose={() => {}} />);
    await waitFor(() => expect(streamApi.prepare).toHaveBeenCalledWith("/r/a.mkv"));
  });

  it("uses the injected prepare function instead of the default", async () => {
    const prepareFn = vi.fn().mockResolvedValue(direct);
    render(
      <VideoPlayerModal file={file} streamUrl="/x" prepareFn={prepareFn} onClose={() => {}} />,
    );
    await waitFor(() => expect(prepareFn).toHaveBeenCalledWith("/r/a.mkv"));
    expect(streamApi.prepare).not.toHaveBeenCalled();
  });

  it("polls the injected status function while preparing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const running: StreamPrepareStatus = { ...direct, status: "running", progress: 10 };
      const prepareFn = vi.fn().mockResolvedValue(running);
      const statusFn = vi.fn().mockResolvedValue(direct);
      render(
        <VideoPlayerModal
          file={file}
          streamUrl="/x"
          prepareFn={prepareFn}
          statusFn={statusFn}
          onClose={() => {}}
        />,
      );
      await vi.advanceTimersByTimeAsync(1600);
      expect(statusFn).toHaveBeenCalledWith("/r/a.mkv");
      expect(streamApi.status).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
