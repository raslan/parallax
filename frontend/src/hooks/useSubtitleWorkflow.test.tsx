// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TitleWithFiles } from "@/lib/subtitleGroups";
import type { ScanFile, SubtitleProvider } from "@/types/subtitle";

const search = vi.fn((_body: { video_path: string; languages: string[] }) =>
  Promise.resolve({ candidates: [], errors: [] }),
);
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: {
    search: (b: { video_path: string; languages: string[] }) => search(b),
    preview: vi.fn(),
    translateSources: vi.fn(),
  },
}));

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
    },
    files: [file],
  },
] as unknown as TitleWithFiles[];

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

describe("useSubtitleWorkflow", () => {
  it("keeps the matches on the Wanted and Sources it started with when they change", async () => {
    const { result, rerender } = setup();
    act(() => result.current.startFind([file]));
    act(() => result.current.toMatches());
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.matches.rows[0]?.status).toBe("none"));
    act(() => result.current.matches.toggleUse(result.current.matches.rows[0]?.key ?? ""));

    rerender({ wanted: ["en", "ar"], sources: ["subf2m", "yts"] });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.current.matches.rows.map((r) => r.language)).toEqual(["en"]);
    expect(result.current.matchesWanted).toEqual(["en"]);
    expect(result.current.matches.rows[0]?.verdict).toBe("use");
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

  it("uses the changed Wanted on the next Find", async () => {
    const { result, rerender } = setup();
    act(() => result.current.startFind([file]));
    rerender({ wanted: ["en", "ar"], sources: ["subf2m"] });
    act(() => result.current.close());
    act(() => result.current.startFind([file]));
    act(() => result.current.toMatches());
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(result.current.matchesWanted).toEqual(["en", "ar"]);
  });
});
