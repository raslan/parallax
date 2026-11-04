// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, getJobs: vi.fn(), getJob: vi.fn(), cancelJob: vi.fn() },
    imageApi: { ...actual.imageApi, listLibraries: vi.fn(), listImages: vi.fn() },
    upscaleApi: { tiers: vi.fn(), start: vi.fn(), credits: vi.fn() },
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
vi.mock("@/components/ImageThumbnail", () => ({ ImageThumbnail: () => <div /> }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

import { api, imageApi, upscaleApi } from "@/lib/api";
import { ImageUpscale } from "./ImageUpscale";
import { ConfirmProvider } from "@/components/ConfirmProvider";

const img = (id: number, name: string, w: number, h: number) => ({
  id,
  library_id: 1,
  path: `/lib/${name}`,
  filename: name,
  extension: ".jpg",
  size: 1000 * id,
  width: w,
  height: h,
  scanned_at: null,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConfirmProvider>
          <ImageUpscale />
        </ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(imageApi.listLibraries).mockResolvedValue([
    { id: 1, name: "Photos", path: "/lib" },
  ] as never);
  vi.mocked(imageApi.listImages).mockResolvedValue({
    items: [img(1, "a.jpg", 1000, 800), img(2, "b.jpg", 4000, 3000)],
    total: 2,
    page: 1,
    page_size: 10000,
  } as never);
  vi.mocked(upscaleApi.tiers).mockResolvedValue({
    gpu_available: false,
    tiers: [
      { id: "simple", label: "Simple", scale: 2, speed: "fast", hint: "", scales: [1, 2] },
      { id: "sharp", label: "Sharp", scale: 2, speed: "fast", hint: "", scales: [1, 2] },
      { id: "best", label: "Best", scale: 4, speed: "slow", hint: "", scales: [1, 2, 4] },
    ],
  });
  vi.mocked(api.getJobs).mockResolvedValue([]);
  vi.mocked(api.getJob).mockResolvedValue({
    id: 9,
    type: "image_upscale",
    status: "running",
    progress: 10,
    current_file: "a.jpg",
    error: null,
  } as never);
  vi.mocked(upscaleApi.start).mockResolvedValue({ job_id: 9, skipped: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ImageUpscale", () => {
  it("shows no action dock until something is selected", async () => {
    renderPage();
    await screen.findByText("a.jpg");
    expect(screen.queryByRole("region", { name: "Selection actions" })).toBeNull();
  });

  it("selecting an image shows 'Upscale 1' and starts the job with the chosen options", async () => {
    renderPage();
    const card = await screen.findByText("a.jpg");
    fireEvent.click(card);
    const btn = await screen.findByRole("button", { name: /Upscale 1/ });
    // Output size of the largest selected image at the default Sharp · 2×.
    expect(screen.getByText(/2000×1600/)).toBeDefined();
    fireEvent.click(btn);
    await waitFor(() =>
      expect(upscaleApi.start).toHaveBeenCalledWith({
        file_ids: [1],
        tier: "sharp",
        scale: 2,
        shrink: 1,
        replace: false,
        keep_original: true,
        force_cpu: false,
      }),
    );
  });

  it("shrink first sends the model's native scale with the chosen shrink factor", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("a.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /Upscale settings/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Shrink first/ }));
    fireEvent.click(screen.getByRole("button", { name: /^¼/ }));
    // 1000×800 → 250×200 → ×2 (Sharp's native scale) = 500×400
    expect(screen.getAllByText(/500×400|500 × 400/).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: /Upscale 1/ }));
    await waitFor(() =>
      expect(upscaleApi.start).toHaveBeenCalledWith({
        file_ids: [1],
        tier: "sharp",
        scale: 2,
        shrink: 4,
        replace: false,
        keep_original: true,
        force_cpu: false,
      }),
    );
  });

  it("replace originals keeps them in quarantine by default and needs no confirmation", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("a.jpg"));
    fireEvent.click(screen.getByRole("switch", { name: /Replace originals/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Upscale 1/ }));
    await waitFor(() =>
      expect(upscaleApi.start).toHaveBeenCalledWith(
        expect.objectContaining({ replace: true, keep_original: true }),
      ),
    );
  });

  it("replacing without keeping originals asks before overwriting", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("a.jpg"));
    fireEvent.click(screen.getByRole("switch", { name: /Replace originals/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Keep originals/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Upscale 1/ }));
    expect(await screen.findByText(/permanently overwritten/i)).toBeDefined();
    expect(upscaleApi.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Replace$/ }));
    await waitFor(() =>
      expect(upscaleApi.start).toHaveBeenCalledWith(
        expect.objectContaining({ replace: true, keep_original: false }),
      ),
    );
  });

  it("cancelling the overwrite confirmation starts nothing", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("a.jpg"));
    fireEvent.click(screen.getByRole("switch", { name: /Replace originals/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Keep originals/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Upscale 1/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByText(/permanently overwritten/i)).toBeNull());
    expect(upscaleApi.start).not.toHaveBeenCalled();
  });

  it("switching to a model with a different native scale starts from that scale", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("a.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /Upscale settings/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Best/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Upscale 1/ }));
    await waitFor(() =>
      expect(upscaleApi.start).toHaveBeenCalledWith({
        file_ids: [1],
        tier: "best",
        scale: 4,
        shrink: 1,
        replace: false,
        keep_original: true,
        force_cpu: false,
      }),
    );
  });

  it("lists skipped files with their reason", async () => {
    vi.mocked(upscaleApi.start).mockResolvedValue({
      job_id: 9,
      skipped: [{ id: 2, reason: "format not supported" }],
    });
    renderPage();
    fireEvent.click(await screen.findByText("a.jpg"));
    fireEvent.click(await screen.findByRole("button", { name: /Upscale 1/ }));
    expect(await screen.findByText(/format not supported/)).toBeDefined();
    expect(screen.getByText(/1 image was skipped/)).toBeDefined();
  });

  it("blocks the run when the output would be over 150 MP", async () => {
    vi.mocked(imageApi.listImages).mockResolvedValue({
      items: [img(1, "huge.jpg", 15000, 11000)],
      total: 1,
      page: 1,
      page_size: 10000,
    } as never);
    renderPage();
    fireEvent.click(await screen.findByText("huge.jpg"));
    const btn = (await screen.findByRole("button", { name: /Upscale 1/ })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/Too large/)).toBeDefined();
  });
  it("only counts and sends the selected images that are still visible", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("a.jpg"));
    await screen.findByRole("button", { name: /Upscale 1/ });
    fireEvent.change(screen.getByPlaceholderText("Search images…"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Upscale \d/ })).toBeNull());
  });
});
