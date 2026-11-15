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
  has_subtitle: false,
  has_any_subtitle: false,
  languages: {},
  machine_languages: {},
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

  it("finds subtitles through Titles, Plan and Run, and goes back to the folder", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([
      video("/tv/A/e1.mkv", ["en"]),
      video("/tv/B/e1.mkv"),
    ]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([
      group("tv:a:", "Alpha", ["/tv/A/e1.mkv"]),
      group("tv:b:", "Beta", ["/tv/B/e1.mkv"]),
    ]);
    vi.mocked(subtitlesApi.search).mockResolvedValue({
      candidates: [
        {
          subtitle_id: "s1",
          provider: "subf2m",
          language: "en",
          release: "Beta.S01E01.WEB",
          score: 1,
          hearing_impaired: false,
        },
      ],
      errors: [],
    });
    vi.mocked(subtitlesApi.preview).mockRejectedValue(new Error("offline"));
    vi.mocked(subtitlesApi.run).mockResolvedValue({ job_id: 9 });
    vi.spyOn(api, "getJob").mockResolvedValue({
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
    });
    renderAt("?path=/tv");
    fireEvent.click(await screen.findByRole("button", { name: "Find subtitles for this folder" }));
    expect(screen.getByText("Titles")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search subtitles for 2 titles" }));

    // Plan (wanted en, ar; scope "missing"): Alpha already has English, so three searches
    // (Alpha ar, Beta en, Beta ar), and nothing is written yet.
    fireEvent.click(await screen.findByRole("button", { name: /Approve all clean rows \(3\)/ }));
    expect(subtitlesApi.search).toHaveBeenCalledTimes(3);
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

  it("says so when the folder has no videos", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([]);
    renderAt("?path=/empty");
    expect(await screen.findByText("No videos in this folder")).toBeTruthy();
  });
});
