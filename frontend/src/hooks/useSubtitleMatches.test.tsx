// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Job } from "@/types/job";
import type {
  Candidate,
  ScanFile,
  SearchResult,
  SearchRowResult,
  SearchSettings,
} from "@/types/subtitle";

const getJob = vi.fn<(id: number) => Promise<Job>>();
const search = vi.fn<(body: unknown) => Promise<SearchResult>>();
const preview = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { getJob: (id: number) => getJob(id) },
  subtitlesApi: { search: (b: unknown) => search(b), preview: () => preview() },
}));

import { useSubtitleMatches } from "./useSubtitleMatches";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const file = (n: number, real = false): ScanFile => ({
  path: `/tv/Show/S01E0${n}.mkv`,
  filename: `S01E0${n}.mkv`,
  relative_dir: "",
  title: "Show",
  season: 1,
  episode: n,
  year: 2016,
  media_type: "episode",
  subtitles: real
    ? [
        {
          path: `/tv/Show/S01E0${n}.en.srt`,
          name: "x",
          language: "en",
          label: null,
          kind: "real",
          size: 1,
          directory: "",
        },
      ]
    : [],
});

const cand = (id: string): Candidate => ({
  subtitle_id: id,
  provider: "subf2m",
  language: "en",
  release: id,
  score: 1,
  hearing_impaired: false,
  release_kind: "episode",
});

const result = (n: number, extra: Partial<SearchRowResult> = {}): SearchRowResult => ({
  title_key: "tv:show",
  video_path: `/tv/Show/S01E0${n}.mkv`,
  language: "en",
  season: 1,
  episode: n,
  state: "checked",
  candidates: [cand(`c${n}`)],
  errors: [],
  length: { last: 2900, video_duration: 3000, verdict: "ok" },
  outcome: null,
  reason: null,
  detail: null,
  saved: null,
  ...extra,
});

const settings = (
  rows: SearchRowResult[],
  extra: Partial<SearchSettings> = {},
): SearchSettings => ({
  path: "/tv/Show",
  providers: ["subf2m"],
  languages: ["en"],
  scope: "missing",
  check_lengths: true,
  save: null,
  titles: [{ key: "tv:show", identity: { title: "Show", year: 2016, type: "tv" }, certain: true }],
  results: Object.fromEntries(rows.map((r) => [`${r.video_path}\0${r.language}`, r])),
  ...extra,
});

const job = (s: SearchSettings, status = "completed", extra: Partial<Job> = {}): Job => ({
  id: 7,
  type: "subtitle_search",
  status,
  library_id: null,
  progress: 100,
  total_files: 0,
  processed_files: 0,
  current_file: null,
  error: null,
  settings: JSON.stringify(s),
  created_at: "",
  started_at: null,
  finished_at: null,
  ...extra,
});

function setup(files: ScanFile[], jobId: number | null = 7, pollMs = 15) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSubtitleMatches({ jobId, files, pollMs }), { wrapper });
}

const files = [file(1), file(2)];

describe("useSubtitleMatches", () => {
  it("reads nothing for no job", () => {
    const { result } = setup(files, null);
    expect(getJob).not.toHaveBeenCalled();
    expect(result.current.rows).toEqual([]);
    expect(result.current.loaded).toBe(false);
  });

  it("only follows the server's job: no search or preview request from the page", async () => {
    getJob.mockResolvedValue(job(settings([result(1), result(2)])));
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(2));
    expect(search).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });

  it("turns the polled results into rows, with the languages and titles of the search", async () => {
    getJob.mockResolvedValue(
      job(settings([result(1), result(2, { state: "searched", candidates: [], length: null })])),
    );
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(2));
    expect(r.current.rows.map((x) => x.status)).toEqual(["ready", "none"]);
    expect(r.current.wanted).toEqual(["en"]);
    expect(r.current.titles).toEqual([{ key: "tv:show", name: "Show (2016)", certain: true }]);
    expect(r.current.running).toBe(false);
    expect(r.current.checksSkipped).toBe(false);
  });

  it("keeps polling while the job runs and stops when it has ended", async () => {
    const running = job(
      settings([
        result(1, { state: "searched", length: null }),
        result(2, { state: "pending", candidates: [], length: null }),
      ]),
      "running",
      { progress: 20 },
    );
    const done = job(settings([result(1), result(2)]));
    getJob.mockResolvedValueOnce(running).mockResolvedValue(done);
    const { result: r } = setup(files, 7, 150);
    await waitFor(() => expect(r.current.running).toBe(true));
    expect(r.current.progress).toEqual({ done: 1, total: 2 });
    expect(r.current.rows[1]?.status).toBe("checking");
    await waitFor(() => expect(r.current.running).toBe(false));
    expect(r.current.progress).toEqual({ done: 2, total: 2 });
    const calls = getJob.mock.calls.length;
    await new Promise((res) => setTimeout(res, 80));
    expect(getJob.mock.calls.length).toBe(calls);
  });

  it("counts the length checks and leaves them out when the search did not check", async () => {
    getJob.mockResolvedValue(
      job(settings([result(1), result(2, { state: "searched", length: null })])),
    );
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(2));
    expect(r.current.checks).toEqual({ done: 1, total: 2 });
    cleanup();
    getJob.mockResolvedValue(
      job(settings([result(1, { state: "searched", length: null })], { check_lengths: false })),
    );
    const { result: r2 } = setup(files);
    await waitFor(() => expect(r2.current.rows).toHaveLength(1));
    expect(r2.current.checksSkipped).toBe(true);
    expect(r2.current.checks).toEqual({ done: 0, total: 0 });
  });

  it("shows a cancelled search's partial results, never-searched rows as failed", async () => {
    getJob.mockResolvedValue(
      job(
        settings([
          result(1, { state: "searched", length: null }),
          result(2, { state: "pending", candidates: [], length: null }),
        ]),
        "cancelled",
        { current_file: "1 of 2 done before cancel" },
      ),
    );
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(2));
    expect(r.current.rows.map((x) => x.status)).toEqual(["ready", "failed"]);
    expect(r.current.jobStatus).toBe("cancelled");
    expect(r.current.running).toBe(false);
  });

  it("keeps the user's verdict across a poll", async () => {
    const first = job(settings([result(1, { state: "searched", length: null })]), "running");
    const next = job(settings([result(1)]), "completed");
    getJob.mockResolvedValueOnce(first).mockResolvedValue(next);
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(1));
    act(() => r.current.toggleUse(r.current.rows[0]?.key ?? ""));
    expect(r.current.rows[0]?.verdict).toBe("use");
    await waitFor(() => expect(r.current.running).toBe(false));
    expect(r.current.rows[0]?.verdict).toBe("use");
    expect(r.current.rows[0]?.lengthResult).toEqual({
      length: "ok",
      last: 2900,
      videoDuration: 3000,
    });
  });

  it("approves every clean row, and a flagged one stays for the user", async () => {
    getJob.mockResolvedValue(
      job(
        settings([
          result(1),
          result(2, { length: { last: 900, video_duration: 3000, verdict: "short" } }),
        ]),
      ),
    );
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(2));
    act(() => r.current.approveAllClean());
    expect(r.current.rows.map((x) => x.verdict)).toEqual(["use", undefined]);
  });

  it("does not approve a title that was left out", async () => {
    getJob.mockResolvedValue(job(settings([result(1)])));
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(1));
    act(() => r.current.approveAllClean(new Set(["tv:show"])));
    expect(r.current.rows[0]?.verdict).toBeUndefined();
  });

  it("searches one row again for Find another, with the title's identity and the job's sources", async () => {
    getJob.mockResolvedValue(
      job(
        settings([result(1, { state: "failed", candidates: [], length: null })], {
          providers: ["subf2m", "yts"],
        }),
      ),
    );
    search.mockResolvedValue({ candidates: [cand("new")], errors: [] });
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(1));
    act(() => r.current.findAnother(r.current.rows[0]?.key ?? ""));
    expect(r.current.rows[0]?.status).toBe("checking");
    await waitFor(() => expect(r.current.rows[0]?.status).toBe("ready"));
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({
      video_path: "/tv/Show/S01E01.mkv",
      identity: { title: "Show", year: 2016, type: "tv" },
      languages: ["en"],
      providers: ["subf2m", "yts"],
      season: 1,
      episode: 1,
    });
    expect(r.current.rows[0]?.candidate?.subtitle_id).toBe("new");
    expect(getJob).toHaveBeenCalled(); // the poll still goes on being the source of the rest
  });

  it("names a failed Find another and keeps the row as it was otherwise", async () => {
    getJob.mockResolvedValue(
      job(settings([result(1, { state: "failed", candidates: [], length: null })])),
    );
    search.mockRejectedValue(new Error("offline"));
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(1));
    act(() => r.current.findAnother(r.current.rows[0]?.key ?? ""));
    await waitFor(() => expect(r.current.rows[0]?.status).toBe("failed"));
    expect(r.current.rows[0]?.errors[0]?.provider).toBe("search");
  });

  it("makes a candidate picked in Compare the row's candidate, listed first", async () => {
    getJob.mockResolvedValue(job(settings([result(1)])));
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(1));
    const length = { length: "ok", last: 100, videoDuration: 120 } as const;
    act(() =>
      r.current.chooseCandidate(r.current.rows[0]?.key ?? "", cand("picked"), "use", length),
    );
    const row = r.current.rows[0];
    expect(row?.candidate?.subtitle_id).toBe("picked");
    expect(row?.candidates.map((c) => c.subtitle_id)).toEqual(["picked", "c1"]);
    expect(row?.verdict).toBe("use");
    expect(row?.lengthResult).toEqual(length);
  });

  it("reports the failures of the sources, apart from sources that do not apply", async () => {
    getJob.mockResolvedValue(
      job(
        settings([
          result(1, {
            state: "searched",
            candidates: [],
            errors: [{ provider: "subf2m", message: "Subf2m refused the request (403)" }],
            length: null,
          }),
          result(2, {
            state: "searched",
            candidates: [],
            errors: [{ provider: "yts", message: "Films only" }],
            length: null,
          }),
        ]),
      ),
    );
    const { result: r } = setup(files);
    await waitFor(() => expect(r.current.rows).toHaveLength(2));
    expect(r.current.errors).toEqual([
      { provider: "subf2m", message: "Subf2m refused the request (403)", count: 1 },
    ]);
    expect(r.current.notes).toEqual([{ provider: "yts", message: "Films only", count: 1 }]);
  });
});
