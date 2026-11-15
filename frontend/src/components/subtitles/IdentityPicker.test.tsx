// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { YtsTitle } from "@/types/subtitle";

const yts = vi.fn<(q: string) => Promise<YtsTitle[]>>();
const parsePasted = vi.fn<(t: string) => Promise<{ imdb_id?: string; subf2m_path?: string }>>();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: {
    yts: (q: string) => yts(q),
    parsePasted: (t: string) => parsePasted(t),
  },
}));

import { IdentityPicker } from "./IdentityPicker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("IdentityPicker", () => {
  it("disables YTS for a show and says it has films only", () => {
    wrap(
      <IdentityPicker
        initial={{ title: "Stranger Things", year: 2016, type: "tv" }}
        onPick={vi.fn()}
        hasTmdbKey={false}
        type="tv"
      />,
    );
    const tab = screen.getByRole("tab", { name: /YTS/ }) as HTMLButtonElement;
    expect(tab.disabled).toBe(true);
    expect(screen.getByText("Films only")).toBeTruthy();
    // Without a TMDB key there is no TMDB tab, and manual search still works.
    expect(screen.queryByRole("tab", { name: /TMDB/ })).toBeNull();
  });

  it("picks a YTS poster with its IMDB id and year", async () => {
    yts.mockResolvedValue([
      { title: "Obsession", year: 2025, imdb_id: "tt3", poster_url: null },
      { title: "Obsession", year: 2024, imdb_id: "tt2", poster_url: null },
    ]);
    const onPick = vi.fn();
    wrap(
      <IdentityPicker
        initial={{ title: "Obsession", year: null, type: "movie" }}
        onPick={onPick}
        hasTmdbKey={false}
        type="movie"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Search YTS" }));
    await waitFor(() => expect(yts).toHaveBeenCalledWith("Obsession"));
    fireEvent.click(await screen.findByRole("button", { name: "Obsession (2024)" }));
    expect(onPick).toHaveBeenCalledWith({
      title: "Obsession",
      year: 2024,
      type: "movie",
      imdb_id: "tt2",
    });
  });

  it("uses a typed title and year from the Subf2m tab", () => {
    const onPick = vi.fn();
    wrap(
      <IdentityPicker
        initial={{ title: "Doctor Who", year: null, type: "tv" }}
        onPick={onPick}
        hasTmdbKey={false}
        type="tv"
      />,
    );
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2005" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this title" }));
    expect(onPick).toHaveBeenCalledWith({ title: "Doctor Who", year: 2005, type: "tv" });
  });

  it("keeps the exact page of a pasted Subf2m link, with the guessed title to edit", async () => {
    parsePasted.mockResolvedValue({ subf2m_path: "/subtitles/obsession-2025" });
    const onPick = vi.fn();
    wrap(
      <IdentityPicker
        initial={{ title: "Obsession", year: 2025, type: "movie" }}
        onPick={onPick}
        hasTmdbKey={false}
        type="movie"
      />,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Paste/ }), { button: 0 });
    fireEvent.change(await screen.findByLabelText("IMDB id or link"), {
      target: { value: "https://subf2m.co/subtitles/obsession-2025" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick).toHaveBeenCalledWith({
      title: "Obsession",
      year: 2025,
      type: "movie",
      subf2m_path: "/subtitles/obsession-2025",
    });
  });

  it("shows the TMDB tab only with a key", () => {
    wrap(
      <IdentityPicker
        initial={{ title: "Show", year: null, type: "tv" }}
        onPick={vi.fn()}
        hasTmdbKey
        type="tv"
      />,
    );
    expect(screen.getByRole("tab", { name: /TMDB/ })).toBeTruthy();
  });
});
