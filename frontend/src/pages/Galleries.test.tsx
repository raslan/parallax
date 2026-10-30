// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
      putGalleryOptions: vi.fn().mockResolvedValue({ ok: true }),
      getGalleryListTypes: vi.fn(),
      putGalleryListTypes: vi.fn().mockResolvedValue({ override: null, effective: {} }),
      deleteGalleryListTypes: vi.fn().mockResolvedValue(undefined),
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

import { api } from "@/lib/api";
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

describe("Galleries per-list content type", () => {
  const types = { typeVideo: true, typeAudio: false, typeImage: false, typeAny: false };

  function fileModeApi() {
    vi.mocked(api.getGalleryOptions).mockResolvedValue({
      inputMode: "file",
      urlList: "mine",
      baseDir: "/g",
    } as never);
    vi.mocked(api.getGalleryUrlLists).mockResolvedValue({ lists: [{ name: "mine", count: 1 }] });
    vi.mocked(api.getGalleryListTypes).mockResolvedValue({ override: null, effective: types });
  }

  afterEach(() => {
    vi.mocked(api.getGalleryOptions).mockResolvedValue({} as never);
    vi.mocked(api.getGalleryUrlLists).mockResolvedValue({ lists: [] });
    vi.mocked(api.putGalleryListTypes).mockClear();
    vi.mocked(api.putGalleryOptions).mockClear();
  });

  it("has no scope toggle in paste mode", async () => {
    renderPage();
    await screen.findByText("Content type");
    expect(screen.queryByText("This list")).toBeNull();
  });

  it("saves a toggle to the list endpoint, not the global options", async () => {
    fileModeApi();
    renderPage();
    // the checkbox is enabled (global scope) before the seeded file mode lands, so wait for the
    // per-list scope toggle first, then for the list's types to load
    await screen.findByText("This list");
    await waitFor(() =>
      expect((screen.getByRole("checkbox", { name: "Image" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Image" }));
    await waitFor(() =>
      expect(api.putGalleryListTypes).toHaveBeenCalledWith("mine", { ...types, typeImage: true }),
    );
    expect(api.putGalleryOptions).not.toHaveBeenCalled();
  });

  it("All lists scope edits the global options instead", async () => {
    fileModeApi();
    renderPage();
    fireEvent.click(await screen.findByText("All lists"));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Image" }));
    await waitFor(() => expect(api.putGalleryOptions).toHaveBeenCalled(), { timeout: 3000 });
    expect(vi.mocked(api.putGalleryOptions).mock.calls[0]?.[0].typeImage).toBe(true);
    expect(api.putGalleryListTypes).not.toHaveBeenCalled();
  });

  it("Use global clears an existing override", async () => {
    fileModeApi();
    vi.mocked(api.getGalleryListTypes).mockResolvedValue({
      override: { ...types, typeAudio: true },
      effective: { ...types, typeAudio: true },
    });
    renderPage();
    fireEvent.click(await screen.findByText("Use global"));
    await waitFor(() => expect(api.deleteGalleryListTypes).toHaveBeenCalledWith("mine"));
  });
});
