// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { subtitlesApi } from "@/lib/api";
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

  it("says so when the folder has no videos", async () => {
    vi.mocked(subtitlesApi.scan).mockResolvedValue([]);
    vi.mocked(subtitlesApi.groups).mockResolvedValue([]);
    renderAt("?path=/empty");
    expect(await screen.findByText("No videos in this folder")).toBeTruthy();
  });
});
