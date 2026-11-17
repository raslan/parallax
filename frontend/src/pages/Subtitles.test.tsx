// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { ScanFile, SubtitleFileInfo, TitleGroup } from "@/types/subtitle";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSettings: vi.fn(async () => ({ subtitle_languages: "en,ar" })),
      getJobs: vi.fn(async () => []),
    },
    subtitlePacksApi: { list: vi.fn(async () => []) },
    speechModelsApi: { list: vi.fn(async () => []) },
    subtitlesApi: {
      ...actual.subtitlesApi,
      scan: vi.fn(),
      groups: vi.fn(),
      unmatched: vi.fn(async () => []),
      active: vi.fn(async () => []),
      checkLengths: vi.fn(async () => ({})),
      search: vi.fn(),
      startSearch: vi.fn(),
      preview: vi.fn(),
      run: vi.fn(),
    },
  };
});
vi.mock("@/components/VirtualizedGrid", () => ({
  VirtualizedGrid: <T,>({
    items,
    renderItem,
  }: {
    items: T[];
    renderItem: (i: T) => React.ReactNode;
  }) => (
    <div>
      {items.map((i, n) => (
        <div key={n}>{renderItem(i)}</div>
      ))}
    </div>
  ),
}));
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
// jsdom has no element scrolling; opening a title scrolls the page to the top.
Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];

import { ConfirmProvider } from "@/components/ConfirmProvider";
import { api, subtitlesApi } from "@/lib/api";
import { Subtitles } from "./Subtitles";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sub = (video: string, language: string): SubtitleFileInfo => ({
  path: `${video}.${language}.srt`,
  name: "x",
  language,
  label: null,
  kind: "real",
  size: 1,
  directory: "",
});

const video = (path: string, langs: string[] = []): ScanFile => ({
  path,
  filename: path.split("/").pop() ?? path,
  relative_dir: "",
  subtitles: langs.map((l) => sub(path, l)),
  title: "",
  season: 1,
  episode: 1,
  year: null,
  media_type: "episode",
});

const group = (key: string, title: string, files: string[], extra: Partial<TitleGroup> = {}) => ({
  key,
  title,
  year: null,
  type: "tv" as const,
  files,
  layout_clean: false,
  needs_choice: false,
  ...extra,
});

/** A search job (as `GET /jobs/{id}` returns it) whose rows are all found and length-checked. */
function searchJob(id: number, status: string, rows: [string, string, string][]) {
  const results = Object.fromEntries(
    rows.map(([video, titleKey, language]) => [
      `${video}\0${language}`,
      {
        title_key: titleKey,
        video_path: video,
        language,
        season: 1,
        episode: 1,
        state: "checked",
        candidates: [
          {
            subtitle_id: `s-${language}`,
            provider: "subf2m",
            language,
            release: "Show.S01E01.WEB",
            score: 1,
            hearing_impaired: false,
            release_kind: "episode",
          },
        ],
        errors: [],
        length: { last: 2900, video_duration: 3000, verdict: "ok" },
        outcome: null,
        reason: null,
        detail: null,
        saved: null,
      },
    ]),
  );
  return {
    id,
    type: "subtitle_search",
    status,
    library_id: null,
    progress: status === "completed" ? 100 : 20,
    total_files: rows.length,
    processed_files: rows.length,
    current_file:
      status === "completed" ? `${rows.length} of ${rows.length} found` : "Searching e1.mkv",
    error: null,
    settings: JSON.stringify({
      path: "/tv",
      providers: ["subf2m"],
      languages: ["en", "ar"],
      scope: "missing",
      check_lengths: true,
      save: null,
      titles: [
        { key: "tv:a:", identity: { title: "Alpha", year: null, type: "tv" }, certain: false },
        { key: "tv:b:", identity: { title: "Beta", year: null, type: "tv" }, certain: false },
      ],
      results,
    }),
    created_at: "2026-11-17T14:20:00",
    started_at: "2026-11-17T14:20:05",
    finished_at: status === "completed" ? "2026-11-17T14:32:10" : null,
  };
}

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.search}</span>;
}

function renderAt(search: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[`/subtitles${search}`]}>
          <Routes>
            <Route
              path="/subtitles"
              element={
                <>
                  <Subtitles />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe("Subtitles Home", () => {
  it("asks for a folder when the URL names none", () => {
    renderAt("");
    expect(screen.getByText("Pick a folder of videos")).toBeTruthy();
    expect(subtitlesApi.scan).not.toHaveBeenCalled();
  });

  it("scans the folder from the URL and shows a card per title", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([
      video("/tv/A/e1.mkv", ["en"]),
      video("/tv/B/e1.mkv"),
    ]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([
      group("tv:a:", "Alpha", ["/tv/A/e1.mkv"], { layout_clean: true }),
      group("tv:b:", "Beta", ["/tv/B/e1.mkv"], { needs_choice: true }),
    ]);
    renderAt("?path=/tv/");
    expect(await screen.findByText("Layout looks right")).toBeTruthy();
    expect(screen.getByText("Pick which one")).toBeTruthy();
    expect(subtitlesApi.scan).toHaveBeenCalledWith("/tv");
    fireEvent.click(screen.getByRole("button", { name: "Open Beta" }));
    expect(screen.getByTestId("where").textContent).toBe("?path=/tv&title=tv%3Ab%3A");
  });

  it("opens a lone title straight into its files", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([video("/m/Film/film.mkv")]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([
      group("movie:film:", "Film", ["/m/Film/film.mkv"], { type: "movie" }),
    ]);
    renderAt("?path=/m");
    expect(await screen.findByText("film.mkv")).toBeTruthy();
    // Nothing to go back to: the lone title is the folder.
    expect(screen.queryByRole("button", { name: /All titles/ })).toBeNull();
  });

  it("opens the Manage panel from a file's Manage entry and lists its subtitle files", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([video("/m/Film/film.mkv", ["en"])]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([
      group("movie:film:", "Film", ["/m/Film/film.mkv"], { type: "movie" }),
    ]);
    vi.spyOn(subtitlesApi, "files").mockResolvedValue([sub("/m/Film/film.mkv", "en")]);
    renderAt("?path=/m");
    fireEvent.click(await screen.findByRole("button", { name: /Manage subtitles for film.mkv/ }));
    expect(await screen.findByText("Manage subtitles")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Make main|Play and check/ })).toBeTruthy();
    expect(subtitlesApi.files).toHaveBeenCalledWith("/m/Film/film.mkv");
  });

  it("makes the panel follow the single selected file, not the file Manage was clicked on", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([
      video("/m/Film/a.mkv", ["en"]),
      video("/m/Film/b.mkv", ["en"]),
    ]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([
      group("movie:film:", "Film", ["/m/Film/a.mkv", "/m/Film/b.mkv"], { type: "movie" }),
    ]);
    const files = vi.spyOn(subtitlesApi, "files").mockImplementation(async (p) => [sub(p, "en")]);
    renderAt("?path=/m");
    // Manage on a selects a and opens the panel.
    fireEvent.click(await screen.findByRole("button", { name: /Manage subtitles for a.mkv/ }));
    expect(await screen.findByText("Manage subtitles")).toBeTruthy();
    expect(files).toHaveBeenLastCalledWith("/m/Film/a.mkv");
    // Selecting b as well leaves two selected: no single file to follow.
    fireEvent.click(screen.getByText("b.mkv"));
    // Un-selecting a leaves b alone: the panel is now b's.
    fireEvent.click(screen.getByText("a.mkv"));
    await waitFor(() => expect(files).toHaveBeenLastCalledWith("/m/Film/b.mkv"));
    expect(screen.getByText("Manage subtitles")).toBeTruthy();
  });

  it("finds subtitles through Titles, Matches and Run, and goes back to the folder", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([
      video("/tv/A/e1.mkv", ["en"]),
      video("/tv/B/e1.mkv"),
    ]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([
      group("tv:a:", "Alpha", ["/tv/A/e1.mkv"]),
      group("tv:b:", "Beta", ["/tv/B/e1.mkv"]),
    ]);
    vi.mocked(subtitlesApi.startSearch).mockResolvedValue({ job_id: 4 });
    vi.mocked(subtitlesApi.run).mockResolvedValue({ job_id: 9 });
    const runJob = {
      id: 9,
      type: "subtitle_download",
      status: "running",
      library_id: null,
      progress: 0,
      total_files: 1,
      processed_files: 0,
      current_file: null,
      error: null,
      settings: JSON.stringify({
        path: "/tv",
        items: [
          {
            video_path: "/tv/B/e1.mkv",
            language: "en",
            provider: "subf2m",
            subtitle_id: "s1",
            sync: false,
          },
        ],
        results: [],
      }),
      created_at: "",
      started_at: null,
      finished_at: null,
    };
    vi.spyOn(api, "getJob").mockImplementation(async (id) =>
      id === 4
        ? searchJob(4, "completed", [
            ["/tv/A/e1.mkv", "tv:a:", "ar"],
            ["/tv/B/e1.mkv", "tv:b:", "en"],
            ["/tv/B/e1.mkv", "tv:b:", "ar"],
          ])
        : runJob,
    );
    renderAt("?path=/tv");
    fireEvent.click(await screen.findByRole("button", { name: "Find subtitles for this folder" }));
    expect(screen.getByText("Titles")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search subtitles for 2 titles" }));

    // Matches (wanted en, ar; scope "missing"): Alpha already has English, so the server is asked
    // for three rows (Alpha ar, Beta en, Beta ar); nothing is searched in this tab and nothing
    // is written yet.
    fireEvent.click(await screen.findByRole("button", { name: /Approve all clean rows \(3\)/ }));
    expect(subtitlesApi.startSearch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(subtitlesApi.startSearch).mock.calls[0]?.[0]).toMatchObject({
      path: "/tv",
      languages: ["en", "ar"],
      scope: "missing",
      check_lengths: true,
      save: null,
    });
    expect(
      vi
        .mocked(subtitlesApi.startSearch)
        .mock.calls[0]?.[0].rows.map((r) => [r.video_path, r.language]),
    ).toEqual([
      ["/tv/A/e1.mkv", "ar"],
      ["/tv/B/e1.mkv", "en"],
      ["/tv/B/e1.mkv", "ar"],
    ]);
    expect(subtitlesApi.search).not.toHaveBeenCalled();
    expect(subtitlesApi.preview).not.toHaveBeenCalled();
    expect(subtitlesApi.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download 3 subtitles" }));
    await waitFor(() =>
      expect(subtitlesApi.run).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/tv", keep_existing: false, sync_after: false }),
      ),
    );

    expect(await screen.findByText(/1 to go/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to folder" }));
    expect(await screen.findByText("Titles · 2")).toBeTruthy();
  });

  it("shows the newest finished search of the folder as Last search and opens its matches", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([video("/tv/A/e1.mkv"), video("/tv/B/e1.mkv")]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([
      group("tv:a:", "Alpha", ["/tv/A/e1.mkv"]),
      group("tv:b:", "Beta", ["/tv/B/e1.mkv"]),
    ]);
    const ended = searchJob(4, "completed", [
      ["/tv/A/e1.mkv", "tv:a:", "en"],
      ["/tv/B/e1.mkv", "tv:b:", "en"],
    ]);
    vi.mocked(api.getJobs).mockResolvedValue([ended]);
    vi.spyOn(api, "getJob").mockResolvedValue(ended);
    renderAt("?path=/tv");
    expect(await screen.findByText(/Last search/)).toBeTruthy();
    expect(screen.getByText(/2 of 2 found/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the matches" }));
    // The Matches view is rebuilt from the job: no new search, nothing searched in this tab.
    expect(await screen.findByRole("button", { name: /Approve all clean rows/ })).toBeTruthy();
    expect(subtitlesApi.startSearch).not.toHaveBeenCalled();
    expect(subtitlesApi.search).not.toHaveBeenCalled();
  });

  it("does not show Last search for another folder's search", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([video("/m/Film/film.mkv")]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([
      group("movie:film:", "Film", ["/m/Film/film.mkv"], { type: "movie" }),
    ]);
    vi.mocked(api.getJobs).mockResolvedValue([
      searchJob(4, "completed", [["/tv/A/e1.mkv", "tv:a:", "en"]]),
    ]);
    renderAt("?path=/m");
    await screen.findByText("film.mkv");
    expect(screen.queryByText(/Last search/)).toBeNull();
  });

  it("shows a running search in Activity with Show the matches, and no Last search beside it", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([video("/tv/A/e1.mkv")]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([group("tv:a:", "Alpha", ["/tv/A/e1.mkv"])]);
    const running = searchJob(4, "running", [["/tv/A/e1.mkv", "tv:a:", "en"]]);
    vi.mocked(api.getJobs).mockResolvedValue([running]);
    vi.mocked(subtitlesApi.active).mockResolvedValue([
      {
        path: "/tv",
        jobs: [
          {
            id: 4,
            type: "subtitle_search",
            status: "running",
            progress: 20,
            current_file: "Searching e1.mkv",
            queue_position: null,
          },
        ],
      },
    ]);
    vi.spyOn(api, "getJob").mockResolvedValue(running);
    renderAt("?path=/tv");
    expect(await screen.findByRole("button", { name: "Show the matches" })).toBeTruthy();
    expect(screen.getByText("Subtitle search")).toBeTruthy();
    expect(screen.queryByText(/Last search/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the matches" }));
    expect(
      await screen.findByText(
        "Searching and checking runs on the server. You can leave this page.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel search" })).toBeTruthy();
  });

  it("says so when the folder has no videos", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([]);
    renderAt("?path=/empty");
    expect(await screen.findByText("No videos in this folder")).toBeTruthy();
  });
});
