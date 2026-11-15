// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  tidy: vi.fn(async () => ({ deleted: 2 })),
  remove: vi.fn(async () => ({ deleted: 1 })),
  makeMain: vi.fn(async () => ({ main: "/m/M.en.srt", other: null })),
  rename: vi.fn(async () => ({ path: "/m/x.srt", outside_view: false })),
  restoreOriginal: vi.fn(async () => ({ ok: true })),
  syncFile: vi.fn(async () => ({ job_id: 4 })),
}));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: api,
}));
const confirm = vi.hoisted(() => vi.fn<(o: { title?: string }) => Promise<boolean>>());
vi.mock("@/components/ConfirmProvider", () => ({ useConfirm: () => confirm }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { useSubtitleManage } from "./useSubtitleManage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const video = { path: "/m/M.mkv", name: "M.mkv" };
function setup() {
  const ui = {
    compare: vi.fn(),
    rename: vi.fn(),
    find: vi.fn(),
    translate: vi.fn(),
    generate: vi.fn(),
  };
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const inv = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSubtitleManage({ folder: "/m", ui }), { wrapper });
  return { result, ui, inv };
}

describe("useSubtitleManage", () => {
  it("asks with the count before deleting, and deletes nothing on cancel", async () => {
    confirm.mockResolvedValue(false);
    const { result } = setup();
    let done = true;
    await act(async () => {
      done = await result.current.act(video, { type: "delete", paths: ["/m/a.srt", "/m/b.srt"] });
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0].title).toContain("2 subtitle files");
    expect(api.remove).not.toHaveBeenCalled();
    expect(done).toBe(false);
  });

  it("deletes after a yes and refreshes the files and the folder", async () => {
    confirm.mockResolvedValue(true);
    const { result, inv } = setup();
    await act(async () => {
      await result.current.act(video, { type: "delete", paths: ["/m/a.srt"] });
    });
    expect(api.remove).toHaveBeenCalledWith(video.path, ["/m/a.srt"]);
    const keys = inv.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["subtitles", "files", video.path]));
    expect(keys).toContain(JSON.stringify(["subtitles", "scan", "/m"]));
  });

  it("confirms each tidy-up with its count and calls tidy with the right choice", async () => {
    confirm.mockResolvedValue(true);
    const { result } = setup();
    for (const what of ["generated_translated", "extra_versions", "originals"] as const) {
      await act(async () => {
        await result.current.act(video, { type: "tidy", what, count: 3 });
      });
      expect(api.tidy).toHaveBeenLastCalledWith([video.path], what);
    }
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(confirm.mock.calls[0]?.[0].title).toContain("3");
  });

  it("does not tidy when the confirm is declined", async () => {
    confirm.mockResolvedValue(false);
    const { result } = setup();
    await act(async () => {
      await result.current.act(video, { type: "tidy", what: "originals", count: 1 });
    });
    expect(api.tidy).not.toHaveBeenCalled();
  });

  it("syncs ONE file with the chosen engine", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.act(video, { type: "sync", path: "/m/M.en.srt", engine: "ffsubsync" });
    });
    await waitFor(() => expect(api.syncFile).toHaveBeenCalledTimes(1));
    expect(api.syncFile).toHaveBeenCalledWith(video.path, undefined, {
      subtitle_path: "/m/M.en.srt",
      engine: "ffsubsync",
    });
  });

  it("makes main and restores through the API, and hands the rest to the page", async () => {
    confirm.mockResolvedValue(true);
    const { result, ui } = setup();
    await act(async () => {
      await result.current.act(video, { type: "make_main", path: "/m/M.en.yts.srt" });
      await result.current.act(video, { type: "restore", path: "/m/M.en.srt" });
      await result.current.act(video, { type: "find" });
      await result.current.act(video, { type: "translate" });
      await result.current.act(video, { type: "generate" });
    });
    expect(api.makeMain).toHaveBeenCalledWith(video.path, "/m/M.en.yts.srt");
    expect(api.restoreOriginal).toHaveBeenCalledWith(video.path, "/m/M.en.srt");
    expect(ui.find).toHaveBeenCalledWith(video.path);
    expect(ui.translate).toHaveBeenCalledWith(video.path);
    expect(ui.generate).toHaveBeenCalledWith(video.path);
  });

  it("renames through the API and rejects with the server's refusal", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.rename(video, "/m/M.en.srt", "M.en.x.srt");
    });
    expect(api.rename).toHaveBeenCalledWith(video.path, "/m/M.en.srt", "M.en.x.srt");
    api.rename.mockRejectedValueOnce(new Error("A file with that name already exists."));
    await expect(result.current.rename(video, "/m/M.en.srt", "M.ar.srt")).rejects.toThrow(
      "already exists",
    );
  });
});
