// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { qk } from "@/lib/api";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

/** Render at `path`; by default both library types have one entry seeded. */
const at = (path: string, { video = 1, image = 1 } = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    qk.libraries(),
    Array.from({ length: video }, (_, i) => ({ id: i + 1 })),
  );
  qc.setQueryData(
    qk.imageLibraries(),
    Array.from({ length: image }, (_, i) => ({ id: i + 1 })),
  );
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Sidebar", () => {
  it("shows only the videos section items on a video route", () => {
    at("/files");
    expect(screen.getByRole("link", { name: /Compress/ })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Content Review/ })).toBeNull();
  });

  it("shows only the images section items on an image route", () => {
    at("/content-review");
    expect(screen.getByRole("link", { name: /Quarantined/ })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Originals/ })).toBeNull();
  });

  it("has no Jobs or Settings link", () => {
    at("/files");
    expect(screen.queryByRole("link", { name: /^Jobs$/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Settings$/ })).toBeNull();
  });

  it("collapses to just Libraries when there are no libraries of that type", () => {
    at("/files", { video: 0 });
    expect(screen.getByRole("link", { name: /Libraries/ })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Files/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Compress/ })).toBeNull();
  });

  it("always renders the presentational + on the Libraries row", () => {
    const { container } = at("/files", { video: 0 });
    const librariesLink = screen.getByRole("link", { name: /Libraries/ });
    expect(librariesLink.querySelector("svg[aria-hidden]")).not.toBeNull();
    expect(container).toBeDefined();
  });
});
