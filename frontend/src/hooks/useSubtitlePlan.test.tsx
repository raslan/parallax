// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Candidate, PlanGroup, PreviewInfo, ScanFile, SearchResult } from "@/types/subtitle";

type Deferred<T> = { resolve: (v: T) => void; reject: (e: unknown) => void };
const searches: { body: { video_path: string; languages: string[] }; d: Deferred<SearchResult> }[] =
  [];
const search = vi.fn(
  (body: { video_path: string; languages: string[] }) =>
    new Promise<SearchResult>((resolve, reject) => {
      searches.push({ body, d: { resolve, reject } });
    }),
);
const preview = vi.fn<(body: unknown) => Promise<PreviewInfo>>();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: {
    search: (b: { video_path: string; languages: string[] }) => search(b),
    preview: (b: unknown) => preview(b),
  },
}));

import { useSubtitlePlan } from "./useSubtitlePlan";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searches.length = 0;
});

const file = (n: number, realEn = false): ScanFile => ({
  path: `/tv/Show/S01E0${n}.mkv`,
  filename: `S01E0${n}.mkv`,
  relative_dir: "",
  has_subtitle: realEn,
  has_any_subtitle: realEn,
  languages: {},
  machine_languages: {},
  title: "Show",
  season: 1,
  episode: n,
  year: null,
  media_type: "episode",
  subtitles: realEn
    ? [
        {
          path: `/tv/Show/S01E0${n}.en.srt`,
          name: `S01E0${n}.en.srt`,
          language: "en",
          label: null,
          kind: "real",
          size: 10,
          directory: "",
        },
      ]
    : [],
});

const group = (files: ScanFile[]): PlanGroup => ({
  key: "tv:show",
  identity: { title: "Show", year: 2016, type: "tv" },
  files,
});

const cand = (id: string): Candidate => ({
  subtitle_id: id,
  provider: "subf2m",
  language: "en",
  release: id,
  score: 1,
  hearing_impaired: false,
});

const empty: SearchResult = { candidates: [], errors: [] };

function setup(files: ScanFile[], scope: "missing" | "all" = "missing") {
  const groups = [group(files)];
  const wanted = ["en"];
  const providers = ["subf2m" as const];
  return renderHook(() => useSubtitlePlan({ groups, wanted, providers, scope }));
}

describe("useSubtitlePlan", () => {
  it("keeps at most two searches in flight, in order", async () => {
    setup([file(1), file(2), file(3), file(4), file(5)]);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(searches.map((s) => s.body.video_path)).toEqual([
      "/tv/Show/S01E01.mkv",
      "/tv/Show/S01E02.mkv",
    ]);
    await act(async () => searches[0]?.d.resolve(empty));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
    expect(searches[2]?.body.video_path).toBe("/tv/Show/S01E03.mkv");
    // Still never more than two unanswered.
    const answered = 1;
    expect(search.mock.calls.length - answered).toBeLessThanOrEqual(2);
  });

  it("skips a language with a real subtitle under 'missing' and searches it under 'all'", async () => {
    const { result } = setup([file(1, true), file(2)]);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(searches[0]?.body.video_path).toBe("/tv/Show/S01E02.mkv");
    expect(result.current.rows.find((r) => r.video.endsWith("E01.mkv"))?.status).toBe("has_real");
    cleanup();
    vi.clearAllMocks();
    searches.length = 0;

    setup([file(1, true), file(2)], "all");
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(searches.map((s) => s.body.video_path)).toEqual([
      "/tv/Show/S01E01.mkv",
      "/tv/Show/S01E02.mkv",
    ]);
  });

  it("stops starting new requests while paused and carries on when resumed", async () => {
    const { result } = setup([file(1), file(2), file(3), file(4)]);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    act(() => result.current.pause());
    await act(async () => {
      searches[0]?.d.resolve(empty);
      searches[1]?.d.resolve(empty);
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.current.progress).toEqual({ done: 2, total: 4 });
    act(() => result.current.resume());
    await waitFor(() => expect(search).toHaveBeenCalledTimes(4));
  });

  it("flags a row whose top candidate looks short", async () => {
    preview.mockResolvedValue({
      preview_id: "p",
      cues: 10,
      first: 1,
      last: 600,
      video_duration: 3000,
      length: "short",
      lines: [],
    });
    const { result } = setup([file(1)]);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await act(async () => searches[0]?.d.resolve({ candidates: [cand("a")], errors: [] }));
    await waitFor(() => expect(result.current.rows[0]?.status).toBe("flagged"));
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ subtitle_id: "a" }));
  });

  it("leaves rows unchecked after Skip checks", async () => {
    const { result } = setup([file(1)]);
    act(() => result.current.skipChecks());
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await act(async () => searches[0]?.d.resolve({ candidates: [cand("a")], errors: [] }));
    await waitFor(() => expect(result.current.rows[0]?.status).toBe("ready"));
    expect(preview).not.toHaveBeenCalled();
    expect(result.current.rows[0]?.lengthResult).toBeUndefined();
  });

  it("shows a source's error on a row with nothing found", async () => {
    const { result } = setup([file(1)]);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await act(async () =>
      searches[0]?.d.resolve({
        candidates: [],
        errors: [{ provider: "subf2m", message: "Subf2m search failed" }],
      }),
    );
    await waitFor(() => expect(result.current.rows[0]?.status).toBe("none"));
    expect(result.current.rows[0]?.errors[0]?.message).toBe("Subf2m search failed");
    expect(result.current.errors).toEqual([
      { provider: "subf2m", message: "Subf2m search failed", count: 1 },
    ]);
  });
});
