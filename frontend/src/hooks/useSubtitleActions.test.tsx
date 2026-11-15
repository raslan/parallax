// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ScanFile, SubtitleFileInfo } from "@/types/subtitle";

const { syncFiles, syncFile } = vi.hoisted(() => ({
  syncFiles: vi.fn(async () => ({ job_id: 9 })),
  syncFile: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: { syncFiles, syncFile },
  api: { cancelJob: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { api } from "@/lib/api";
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
  });

  it("sends nothing when no chosen video has a subtitle", async () => {
    const { result } = renderHook(() => useSubtitleActions("/tv"), { wrapper });
    act(() => result.current.sync([video("/tv/c.mkv", false)]));
    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(syncFiles).not.toHaveBeenCalled();
  });

  it("treats a cancel on an already finished job as done, with a neutral note", async () => {
    vi.mocked(api.cancelJob).mockRejectedValueOnce(new Error("400: Job is not active"));
    const { result } = renderHook(() => useSubtitleActions("/tv"), { wrapper });
    act(() => result.current.cancel(4));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("That job had already finished."));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
