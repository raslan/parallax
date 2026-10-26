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
      getGalleryOptions: vi.fn().mockResolvedValue({}),
      getGalleryArchive: vi
        .fn()
        .mockResolvedValue({ path: "/a.sqlite3", exists: false, size: 0, entries: 0 }),
      getGalleryUrlLists: vi.fn().mockResolvedValue({ lists: [] }),
      getGalleryUrlList: vi.fn().mockResolvedValue({ name: "default", text: "" }),
      galleryDlInfo: vi.fn().mockResolvedValue({ installed: true, version: "1.27.0", path: "/x" }),
      galleryYtdlImpersonateTargets: vi.fn().mockResolvedValue({ targets: [] }),
    },
  };
});

// Radix Slider (in GalleryOptionsPanel) reads ResizeObserver, absent from jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

afterEach(cleanup);

import { Galleries } from "./Galleries";
import { ConfirmProvider } from "@/components/ConfirmProvider";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <MemoryRouter>
          <Galleries />
        </MemoryRouter>
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

describe("Galleries page", () => {
  it("renders the header and an empty queue", async () => {
    renderPage();
    expect(screen.getByText("Galleries")).toBeTruthy();
    expect(await screen.findByText("No galleries yet")).toBeTruthy();
  });

  it("shows the options panel once seeded", async () => {
    renderPage();
    expect(screen.getByText("Options")).toBeTruthy();
    // seed-once effect swaps the loader for the real panel — its first label.
    expect(await screen.findByText("Base directory")).toBeTruthy();
  });
});
