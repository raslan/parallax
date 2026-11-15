// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Candidate, PlanRowState, RunItem, ScanFile, SearchResult } from "@/types/subtitle";

const search = vi.fn<(body: unknown) => Promise<SearchResult>>();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: { search: (b: unknown) => search(b) },
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

import { useSubtitleCompare } from "./useSubtitleCompare";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const cand = (id: string): Candidate => ({
  subtitle_id: id,
  provider: "subf2m",
  language: "en",
  release: id,
  score: 1,
  hearing_impaired: false,
});
const video = {
  path: "/tv/Show/S01E01.mkv",
  filename: "S01E01.mkv",
  title: "Show",
  year: 2016,
  season: 1,
  episode: 1,
  media_type: "episode",
} as ScanFile;
const item: RunItem = {
  video_path: video.path,
  language: "en",
  provider: "subf2m",
  subtitle_id: "bad",
  sync: false,
};
const row = {
  key: "k",
  video: video.path,
  filename: video.filename,
  candidates: [cand("a"), cand("b")],
} as PlanRowState;

function setup() {
  const chooseCandidate = vi.fn();
  const setVerdict = vi.fn();
  const retry = vi.fn();
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const onExisting = vi.fn<(...a: unknown[]) => Promise<boolean>>(async () => true);
  const hook = renderHook(
    () => useSubtitleCompare({ files: [video], chooseCandidate, setVerdict, retry, onExisting }),
    { wrapper },
  );
  return { ...hook, chooseCandidate, setVerdict, retry, onExisting };
}

const existingFile = {
  path: "/tv/Show/S01E01.en.srt",
  name: "S01E01.en.srt",
  language: "en",
  label: null,
  kind: "real",
  size: 1,
  directory: "",
} as const;
const vid = { path: video.path, name: video.filename };

describe("useSubtitleCompare existing mode", () => {
  it("opens for a subtitle the video has", () => {
    const { result } = setup();
    act(() => result.current.openExisting(vid, existingFile));
    expect(result.current.sheet).toMatchObject({ mode: "existing", existing: existingFile });
  });

  it("tells the page when the file is a stray one, so Delete uses the folder-scoped call", async () => {
    const { result, onExisting } = setup();
    act(() => result.current.openExisting(vid, existingFile, true));
    expect(result.current.sheet).toMatchObject({ existing: existingFile, stray: true });
    await act(async () => result.current.verdict("delete"));
    expect(onExisting).toHaveBeenLastCalledWith("delete", vid, existingFile, true);
  });

  it("Keep closes without acting", async () => {
    const { result, onExisting } = setup();
    act(() => result.current.openExisting(vid, existingFile));
    await act(async () => result.current.verdict("keep"));
    expect(onExisting).not.toHaveBeenCalled();
    expect(result.current.sheet).toBeNull();
  });

  it("Sync and Find another act on that file and close", async () => {
    const { result, onExisting } = setup();
    act(() => result.current.openExisting(vid, existingFile));
    await act(async () => result.current.verdict("sync"));
    expect(onExisting).toHaveBeenLastCalledWith("sync", vid, existingFile, false);
    expect(result.current.sheet).toBeNull();
    act(() => result.current.openExisting(vid, existingFile));
    await act(async () => result.current.verdict("find_another"));
    expect(onExisting).toHaveBeenLastCalledWith("find_another", vid, existingFile, false);
    expect(result.current.sheet).toBeNull();
  });

  it("Delete closes only when the delete was carried out", async () => {
    const { result, onExisting } = setup();
    onExisting.mockResolvedValueOnce(false);
    act(() => result.current.openExisting(vid, existingFile));
    await act(async () => result.current.verdict("delete"));
    expect(onExisting).toHaveBeenLastCalledWith("delete", vid, existingFile, false);
    expect(result.current.sheet).not.toBeNull();
    await act(async () => result.current.verdict("delete"));
    expect(result.current.sheet).toBeNull();
  });
});

describe("useSubtitleCompare", () => {
  it("names the failure when the search for another subtitle fails", async () => {
    search.mockRejectedValue(new Error("Subf2m is not answering"));
    const { result } = setup();
    act(() => result.current.openItem(item));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Subf2m is not answering"));
    expect(result.current.sheet).toBeNull();
  });

  it("names a video that is no longer in the folder", async () => {
    const { result } = setup();
    act(() => result.current.openItem({ ...item, video_path: "/gone.mkv" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(search).not.toHaveBeenCalled();
    expect(result.current.sheet).toBeNull();
  });

  it("knows which item is being searched and ignores a second click meanwhile", async () => {
    let finish: (r: SearchResult) => void = () => undefined;
    search.mockImplementation(
      () =>
        new Promise<SearchResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = setup();
    act(() => result.current.openItem(item));
    await waitFor(() => expect(result.current.searchingItem).toEqual(item));
    act(() => result.current.openItem(item));
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => finish({ candidates: [cand("x")], errors: [] }));
    await waitFor(() => expect(result.current.searchingItem).toBeNull());
    expect(result.current.sheet?.candidates.map((c) => c.subtitle_id)).toEqual(["x"]);
  });

  it("opens with an empty list (for the sheet's message) when nothing else is found", async () => {
    search.mockResolvedValue({ candidates: [cand("bad")], errors: [] });
    const { result } = setup();
    act(() => result.current.openItem(item));
    await waitFor(() => expect(result.current.sheet).not.toBeNull());
    expect(result.current.sheet?.candidates).toEqual([]);
  });

  it("'Not this one' on a plan row only sets the skip verdict", () => {
    const { result, chooseCandidate, setVerdict } = setup();
    act(() => result.current.openRow(row));
    act(() => result.current.verdict("skip", cand("b")));
    expect(setVerdict).toHaveBeenCalledWith("k", "skip");
    expect(chooseCandidate).not.toHaveBeenCalled();
    expect(result.current.sheet).toBeNull();
  });

  it("passes the length the sheet already measured to the plan row", () => {
    const { result, chooseCandidate } = setup();
    const length = { length: "ok", last: 100, videoDuration: 120 } as const;
    act(() => result.current.openRow(row));
    act(() => result.current.verdict("use", cand("b"), length));
    expect(chooseCandidate).toHaveBeenCalledWith("k", cand("b"), "use", length);
  });
});
