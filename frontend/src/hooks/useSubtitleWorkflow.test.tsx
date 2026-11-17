// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TitleWithFiles } from "@/lib/subtitleGroups";
import type { Job } from "@/types/job";
import type {
  ActiveWork,
  ScanFile,
  SearchRequest,
  SearchSettings,
  SubtitleProvider,
} from "@/types/subtitle";

const startSearch = vi.fn<(body: SearchRequest) => Promise<{ job_id: number }>>();
const active = vi.fn<() => Promise<ActiveWork[]>>();
const getJob = vi.fn<(id: number) => Promise<Job>>();
const cancelJob = vi.fn<(id: number) => Promise<{ message: string }>>();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { getJob: (id: number) => getJob(id), cancelJob: (id: number) => cancelJob(id) },
  subtitlesApi: {
    startSearch: (b: SearchRequest) => startSearch(b),
    active: () => active(),
    search: vi.fn(),
    translateSources: vi.fn(),
  },
}));
const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { useSubtitleWorkflow } from "./useSubtitleWorkflow";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const file: ScanFile = {
  path: "/films/Movie.mkv",
  filename: "Movie.mkv",
  relative_dir: "",
  title: "Movie",
  season: null,
  episode: null,
  year: 2020,
  media_type: "movie",
  subtitles: [],
};

const titles = [
  {
    group: {
      key: "movie:movie:2020",
      title: "Movie",
      year: 2020,
      type: "movie",
      files: [file.path],
      layout_clean: false,
      needs_choice: false,
    },
    files: [file],
  },
] as unknown as TitleWithFiles[];

const searchJob = (id: number, status: string): Job => {
  const settings: SearchSettings = {
    path: "/films",
    providers: ["subf2m"],
    languages: ["en"],
    scope: "missing",
    check_lengths: true,
    save: null,
    titles: [
      {
        key: "movie:movie:2020",
        identity: { title: "Movie", year: 2020, type: "movie" },
        certain: false,
      },
    ],
    results: {
      [`${file.path}\0en`]: {
        title_key: "movie:movie:2020",
        video_path: file.path,
        language: "en",
        season: null,
        episode: null,
        state: "pending",
        candidates: [],
        errors: [],
        length: null,
        outcome: null,
        reason: null,
        detail: null,
        saved: null,
      },
    },
  };
  return {
    id,
    type: "subtitle_search",
    status,
    library_id: null,
    progress: 0,
    total_files: 1,
    processed_files: 0,
    current_file: null,
    error: null,
    settings: JSON.stringify(settings),
    created_at: "",
    started_at: null,
    finished_at: null,
  };
};

function setup(withTitles: TitleWithFiles[] = titles) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(
    (p: { wanted: string[]; sources: SubtitleProvider[] }) =>
      useSubtitleWorkflow({ folder: "/films", titles: withTitles, ...p }),
    { wrapper, initialProps: { wanted: ["en"], sources: ["subf2m"] as SubtitleProvider[] } },
  );
}

const mockStart = (id = 5, status = "running") => {
  startSearch.mockResolvedValue({ job_id: id });
  getJob.mockImplementation(async (jid) => searchJob(jid, status));
};

describe("useSubtitleWorkflow Find subtitles", () => {
  it("starts one search on the server for the kept titles, then only follows it", async () => {
    mockStart(5);
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.toMatches());
    await waitFor(() => expect(result.current.wf?.stage).toBe("matches"));
    expect(startSearch).toHaveBeenCalledTimes(1);
    expect(startSearch).toHaveBeenCalledWith({
      path: "/films",
      providers: ["subf2m"],
      languages: ["en"],
      scope: "missing",
      check_lengths: true,
      save: null,
      titles: [
        {
          key: "movie:movie:2020",
          identity: { title: "Movie", year: 2020, type: "movie" },
          certain: false,
        },
      ],
      rows: [
        {
          key: `${file.path}\0en`,
          title_key: "movie:movie:2020",
          video_path: file.path,
          language: "en",
          season: null,
          episode: null,
        },
      ],
    });
    await waitFor(() => expect(result.current.matches.rows).toHaveLength(1));
    expect(result.current.matches.jobId).toBe(5);
  });

  it("keeps the search on the Wanted and Sources it started with when they change", async () => {
    mockStart(5);
    const { result, rerender } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.toMatches());
    await waitFor(() => expect(result.current.matches.rows).toHaveLength(1));
    act(() => result.current.matches.toggleUse(result.current.matches.rows[0]?.key ?? ""));

    rerender({ wanted: ["en", "ar"], sources: ["subf2m", "yts"] });

    expect(startSearch).toHaveBeenCalledTimes(1);
    expect(result.current.matches.rows.map((r) => r.language)).toEqual(["en"]);
    expect(result.current.matchesWanted).toEqual(["en"]);
    expect(result.current.matches.rows[0]?.verdict).toBe("use");
  });

  it("uses the changed Wanted on the next Find", async () => {
    mockStart(5);
    const { result, rerender } = setup();
    act(() => result.current.startFind([file]));
    rerender({ wanted: ["en", "ar"], sources: ["subf2m"] });
    act(() => result.current.close());
    act(() => result.current.startFind([file]));
    act(() => result.current.toMatches());
    await waitFor(() => expect(startSearch).toHaveBeenCalledTimes(1));
    expect(startSearch.mock.calls[0]?.[0].languages).toEqual(["en", "ar"]);
    expect(startSearch.mock.calls[0]?.[0].rows.map((r) => r.language)).toEqual(["en", "ar"]);
  });

  it("flags a 'Pick which one' title as unconfirmed until the user picks an identity", () => {
    const pick = [
      { ...titles[0], group: { ...titles[0]?.group, needs_choice: true } },
    ] as unknown as TitleWithFiles[];
    const { result } = setup(pick);
    act(() => result.current.startFind([file]));
    expect([...result.current.unconfirmed]).toEqual(["movie:movie:2020"]);
    act(() =>
      result.current.setIdentity("movie:movie:2020", { title: "Movie", year: 2020, type: "movie" }),
    );
    expect(result.current.unconfirmed.size).toBe(0);
  });

  it("sends a title the user confirmed as certain", async () => {
    mockStart(5);
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() =>
      result.current.setIdentity("movie:movie:2020", { title: "Movie", year: 2020, type: "movie" }),
    );
    act(() => result.current.toMatches());
    await waitFor(() => expect(startSearch).toHaveBeenCalledTimes(1));
    expect(startSearch.mock.calls[0]?.[0].titles[0]?.certain).toBe(true);
  });

  it("does not start a search when every wanted language already has a real subtitle", () => {
    const real = {
      ...file,
      subtitles: [
        {
          path: `${file.path}.en.srt`,
          name: "x",
          language: "en",
          label: null,
          kind: "real",
          size: 1,
          directory: "",
        },
      ],
    } as ScanFile;
    const { result } = setup([{ ...titles[0], files: [real] }] as unknown as TitleWithFiles[]);
    act(() => result.current.startFind([real]));
    act(() => result.current.toMatches());
    expect(startSearch).not.toHaveBeenCalled();
    expect(result.current.wf?.stage).toBe("titles");
    expect(toast.info).toHaveBeenCalled();
  });

  it("opens the search that is already running when another device started one (409)", async () => {
    startSearch.mockRejectedValue(
      new Error('409: {"detail":"A search is already running for this folder"}'),
    );
    active.mockResolvedValue([
      {
        path: "/films",
        jobs: [
          {
            id: 12,
            type: "subtitle_search",
            status: "running",
            progress: 10,
            current_file: null,
            queue_position: null,
          },
        ],
      },
    ]);
    getJob.mockImplementation(async (id) => searchJob(id, "running"));
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.toMatches());
    await waitFor(() => expect(result.current.wf?.stage).toBe("matches"));
    expect(result.current.matches.jobId).toBe(12);
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/already running/));
  });

  it("names the error when starting fails for another reason", async () => {
    startSearch.mockRejectedValue(new Error('400: {"detail":"Video not found: Movie.mkv"}'));
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.toMatches());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Video not found: Movie.mkv"));
    expect(result.current.wf?.stage).toBe("titles");
  });

  it("cancels this page's own unfinished search before starting a new one", async () => {
    startSearch.mockResolvedValueOnce({ job_id: 11 }).mockResolvedValueOnce({ job_id: 12 });
    getJob.mockImplementation(async (id) => searchJob(id, "running"));
    cancelJob.mockResolvedValue({ message: "ok" });
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.toMatches());
    await waitFor(() => expect(result.current.matches.running).toBe(true));
    act(() => result.current.toTitles());
    expect(cancelJob).not.toHaveBeenCalled();
    act(() => result.current.toMatches());
    await waitFor(() => expect(startSearch).toHaveBeenCalledTimes(2));
    expect(cancelJob).toHaveBeenCalledWith(11);
    expect(cancelJob.mock.invocationCallOrder[0]).toBeLessThan(
      startSearch.mock.invocationCallOrder[1] ?? 0,
    );
    await waitFor(() => expect(result.current.matches.jobId).toBe(12));
  });

  it("does not cancel a search that has finished", async () => {
    startSearch.mockResolvedValueOnce({ job_id: 11 }).mockResolvedValueOnce({ job_id: 12 });
    getJob.mockImplementation(async (id) => searchJob(id, "completed"));
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.toMatches());
    await waitFor(() => expect(result.current.matches.running).toBe(false));
    await waitFor(() => expect(result.current.matches.loaded).toBe(true));
    act(() => result.current.toTitles());
    act(() => result.current.toMatches());
    await waitFor(() => expect(startSearch).toHaveBeenCalledTimes(2));
    expect(cancelJob).not.toHaveBeenCalled();
  });

  it("opens the matches of a search job that is already on the server", async () => {
    getJob.mockImplementation(async (id) => searchJob(id, "completed"));
    const { result } = setup();
    act(() => result.current.openMatches(21));
    expect(result.current.wf?.stage).toBe("matches");
    await waitFor(() => expect(result.current.matches.rows).toHaveLength(1));
    expect(result.current.matches.jobId).toBe(21);
    expect(startSearch).not.toHaveBeenCalled();
    // Without the Titles step's choices, the title's own certainty decides.
    expect([...result.current.matchesUnconfirmed]).toEqual(["movie:movie:2020"]);
  });
});

describe("useSubtitleWorkflow automatic save", () => {
  it("starts with Check lengths on and the review way, and no run options chosen", () => {
    const { result } = setup();
    act(() => result.current.startFind([file]));
    expect(result.current.checkLengths).toBe(true);
    expect(result.current.autoSave).toBe(false);
    expect(result.current.saveOptions).toEqual({
      keepExisting: false,
      syncAfter: false,
      engine: "alass",
    });
  });

  it("sends check_lengths false when the tickbox is off, and never saves in review mode", async () => {
    mockStart(5);
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.setCheckLengths(false));
    act(() => result.current.toMatches());
    await waitFor(() => expect(startSearch).toHaveBeenCalledTimes(1));
    expect(startSearch.mock.calls[0]?.[0]).toMatchObject({ check_lengths: false, save: null });
  });

  it("with automatic save sends the run options and forces the length check on", async () => {
    mockStart(5);
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.setCheckLengths(false));
    act(() => result.current.setAutoSave(true));
    expect(result.current.checkLengths).toBe(true); // choosing it turns the check on
    act(() => result.current.setSaveOptions({ keepExisting: true, engine: "ffsubsync" }));
    act(() => result.current.toMatches());
    await waitFor(() => expect(startSearch).toHaveBeenCalledTimes(1));
    expect(startSearch.mock.calls[0]?.[0]).toMatchObject({
      check_lengths: true,
      save: { keep_existing: true, sync_after: false, engine: "ffsubsync" },
    });
  });

  it("sends no engine of its own when the user did not choose one, so Settings decides", async () => {
    mockStart(5);
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.setAutoSave(true));
    act(() => result.current.toMatches());
    await waitFor(() => expect(startSearch).toHaveBeenCalledTimes(1));
    expect(startSearch.mock.calls[0]?.[0].save).toEqual({
      keep_existing: false,
      sync_after: false,
      engine: null,
    });
  });

  it("is off again, with nothing remembered, on every new Find subtitles", () => {
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.setAutoSave(true));
    act(() => result.current.setSaveOptions({ keepExisting: true, syncAfter: true }));
    act(() => result.current.close());
    act(() => result.current.startFind([file]));
    expect(result.current.autoSave).toBe(false);
    expect(result.current.checkLengths).toBe(true);
    expect(result.current.saveOptions).toEqual({
      keepExisting: false,
      syncAfter: false,
      engine: "alass",
    });
  });

  it("switching automatic save off leaves Check lengths on", () => {
    const { result } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.setAutoSave(true));
    act(() => result.current.setAutoSave(false));
    expect(result.current.checkLengths).toBe(true);
  });
});
