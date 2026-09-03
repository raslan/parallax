// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Mock the API barrel so the page's two queries resolve to fixtures.
const getLibraries = vi.fn();
const getJobs = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, getLibraries: () => getLibraries(), getJobs: () => getJobs() },
  };
});

import { Libraries } from "@/pages/Libraries";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Libraries />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LibraryManagerPage (via Libraries route)", () => {
  beforeEach(() => {
    getLibraries.mockReset();
    getJobs.mockReset().mockResolvedValue([]);
  });

  it("renders the empty state when there are no libraries", async () => {
    getLibraries.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No libraries")).toBeDefined();
  });

  it("renders a card per library with its name and file count", async () => {
    getLibraries.mockResolvedValue([
      {
        id: 1,
        name: "Movies",
        path: "/media/movies",
        last_scanned_at: "2026-09-03T00:00:00",
        file_count: 12,
      },
    ]);
    renderPage();
    expect(await screen.findByText("Movies")).toBeDefined();
    expect(screen.getByText("/media/movies")).toBeDefined();
    expect(screen.getByText(/12/)).toBeDefined();
  });
});
