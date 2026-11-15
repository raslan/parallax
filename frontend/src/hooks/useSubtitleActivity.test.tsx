// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActiveWork } from "@/types/subtitle";
import type { Job } from "@/types/job";

const active = vi.fn<() => Promise<ActiveWork[]>>();
const getJobs = vi.fn<() => Promise<Job[]>>();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: { active: () => active() },
  api: { getJobs: () => getJobs() },
}));

import { useSubtitleActivity } from "./useSubtitleActivity";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const job = (id: number, extra: Partial<ActiveWork["jobs"][number]> = {}) => ({
  id,
  type: "subtitle_download",
  status: "running",
  progress: 10,
  current_file: null,
  queue_position: null,
  ...extra,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useSubtitleActivity", () => {
  it("returns the jobs started from a folder or a folder inside it", async () => {
    active.mockResolvedValue([
      { path: "/tv", jobs: [job(1)] },
      { path: "/tv/Show/Season 01", jobs: [job(2, { type: "subtitle_sync" })] },
      { path: "/tvx", jobs: [job(3)] },
      { path: "/films", jobs: [job(4)] },
    ]);
    getJobs.mockResolvedValue([]);
    const { result } = renderHook(() => useSubtitleActivity(), { wrapper });
    await waitFor(() => expect(result.current.work).toHaveLength(4));
    expect(result.current.activeFor("/tv").map((j) => j.id)).toEqual([1, 2]);
    expect(result.current.activeFor("/films").map((j) => j.id)).toEqual([4]);
    expect(result.current.activeFor(null)).toEqual([]);
  });

  it("takes live progress and the current file from the jobs feed", async () => {
    active.mockResolvedValue([{ path: "/tv", jobs: [job(1)] }]);
    getJobs.mockResolvedValue([
      {
        id: 1,
        type: "subtitle_download",
        status: "running",
        progress: 55,
        current_file: "e05.mkv",
      } as Job,
    ]);
    const { result } = renderHook(() => useSubtitleActivity(), { wrapper });
    await waitFor(() => expect(result.current.activeFor("/tv")[0]?.progress).toBe(55));
    expect(result.current.activeFor("/tv")[0]?.current_file).toBe("e05.mkv");
  });

  it("drops a job that finished even when the jobs feed never reported it", async () => {
    // The feed backs off to one tick per 10 s while idle, so a job that starts and ends in
    // under a second can go by unseen; the list must not wait for it.
    active.mockResolvedValueOnce([{ path: "/tv", jobs: [job(1)] }]).mockResolvedValue([]);
    getJobs.mockResolvedValue([]);
    const { result } = renderHook(() => useSubtitleActivity(), { wrapper });
    await waitFor(() => expect(result.current.activeFor("/tv")).toHaveLength(1));
    await waitFor(() => expect(result.current.activeFor("/tv")).toHaveLength(0), {
      timeout: 4000,
    });
    // ...and the header's job count (the tab title) is refreshed with it.
    await waitFor(() => expect(getJobs.mock.calls.length).toBeGreaterThan(1));
  });
});
