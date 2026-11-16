// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActiveJob } from "@/types/subtitle";

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: {
    scan: vi.fn(async () => []),
    groups: vi.fn(async () => []),
    unmatched: vi.fn(async () => []),
    checkLengths: vi.fn(async () => ({})),
  },
}));

import { useSubtitleFolder } from "./useSubtitleFolder";

afterEach(cleanup);

const job = (id: number): ActiveJob => ({
  id,
  type: "subtitle_sync",
  status: "running",
  progress: 0,
  current_file: null,
  queue_position: null,
});

describe("useSubtitleFolder", () => {
  it("reads the videos' subtitle files again when a job for the folder ends", () => {
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/subtitles?path=/m"]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = renderHook(({ jobs }) => useSubtitleFolder(() => jobs), {
      wrapper,
      initialProps: { jobs: [job(4)] },
    });
    inv.mockClear();
    rerender({ jobs: [] });
    const keys = inv.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["subtitles", "scan", "/m"]));
    // A one-file sync from the Manage panel has no scan of its own to refresh.
    expect(keys).toContain(JSON.stringify(["subtitles", "files"]));
    expect(keys).toContain(JSON.stringify(["subtitles", "tracks"]));
  });
});
