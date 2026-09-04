// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getJobs: () => Promise.resolve([]),
      getLibraries: () => Promise.resolve([]),
    },
    imageApi: { ...actual.imageApi, listLibraries: () => Promise.resolve([]) },
  };
});
// EventSource + matchMedia stubbed globally in src/test-setup.ts (Task 1).

import { Header } from "./Header";

afterEach(cleanup);

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Header />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Header", () => {
  it("marks the Images tab active on an image route", () => {
    renderAt("/image-duplicates");
    expect(screen.getByRole("link", { name: "Images" }).getAttribute("data-active")).toBe("true");
    expect(screen.getByRole("link", { name: "Videos" }).getAttribute("data-active")).toBe("false");
  });

  it("marks no tab active on /settings", () => {
    renderAt("/settings");
    for (const name of ["Videos", "Images", "Tools"]) {
      expect(screen.getByRole("link", { name }).getAttribute("data-active")).toBe("false");
    }
  });
});
