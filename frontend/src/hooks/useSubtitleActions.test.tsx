// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ScanFile, SubtitleFileInfo } from "@/types/subtitle";

const { syncFiles, syncFile, syncBulk } = vi.hoisted(() => ({
  syncFiles: vi.fn(async () => ({ job_id: 9 })),
  syncFile: vi.fn(),
  syncBulk: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: { syncFiles, syncFile, syncBulk },
  api: { cancelJob: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { useSubtitleActions } from "./useSubtitleActions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sub = (video: string): SubtitleFileInfo => ({
  path: `${video}.en.srt`,
  name: "x",
  language: "en",
  label: null,
  kind: "real",
  size: 1,
  directory: "",
});
const video = (path: string, withSub = true) =>
  ({ path, filename: path, subtitles: withSub ? [sub(path)] : [] }) as unknown as ScanFile;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useSubtitleActions", () => {
  it("syncs a selection as one job started from the folder", async () => {
    const { result } = renderHook(() => useSubtitleActions("/tv"), { wrapper });
    act(() =>
      result.current.sync([video("/tv/a.mkv"), video("/tv/b.mkv"), video("/tv/c.mkv", false)]),
    );
    await waitFor(() => expect(syncFiles).toHaveBeenCalledTimes(1));
    expect(syncFiles).toHaveBeenCalledWith(["/tv/a.mkv", "/tv/b.mkv"], { path: "/tv" });
    expect(syncFile).not.toHaveBeenCalled();
    expect(syncBulk).not.toHaveBeenCalled();
  });

  it("sends nothing when no chosen video has a subtitle", async () => {
    const { result } = renderHook(() => useSubtitleActions("/tv"), { wrapper });
    act(() => result.current.sync([video("/tv/c.mkv", false)]));
    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(syncFiles).not.toHaveBeenCalled();
  });
});
