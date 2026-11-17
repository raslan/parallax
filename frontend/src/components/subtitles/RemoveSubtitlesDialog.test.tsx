// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ConfirmProvider";

const removeCounts = vi.fn();
const removeByKind = vi.fn();
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  subtitlesApi: {
    removeCounts: (...a: unknown[]) => removeCounts(...a),
    removeByKind: (...a: unknown[]) => removeByKind(...a),
  },
}));

import { RemoveSubtitlesDialog } from "./RemoveSubtitlesDialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const COUNTS = {
  ar: { real: 4, hearing_impaired: 1, generated: 2, translated: 1, original: 1 },
  en: { real: 3 },
};
const VIDEOS = ["/tv/a.mkv", "/tv/b.mkv"];

function renderDialog(over: Partial<Parameters<typeof RemoveSubtitlesDialog>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const props = {
    open: true,
    folder: "/tv",
    videoPaths: VIDEOS,
    onClose: vi.fn(),
    onRemoved: vi.fn(),
    ...over,
  };
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <RemoveSubtitlesDialog {...props} />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  return { ...props, invalidate };
}

const cell = (language: string, kind: string) =>
  screen.getByRole("checkbox", { name: `${language} ${kind}` }) as HTMLButtonElement;
const removeButton = () => screen.getByRole("button", { name: /^Remove/ }) as HTMLButtonElement;

describe("RemoveSubtitlesDialog", () => {
  it("lists the counts by language and kind for the selected videos", async () => {
    removeCounts.mockResolvedValue(COUNTS);
    renderDialog();
    await screen.findByRole("table");
    expect(removeCounts).toHaveBeenCalledWith(VIDEOS);
    for (const head of ["Real", "Hearing impaired", "Generated", "Translated", "Sync backups"]) {
      expect(screen.getByRole("columnheader", { name: head })).toBeTruthy();
    }
    const arabic = screen.getByRole("row", { name: /Arabic/ });
    expect(arabic.textContent).toMatch(/4/);
    expect(within(arabic).getAllByRole("checkbox")).toHaveLength(5);
    const english = screen.getByRole("row", { name: /English/ });
    expect(within(english).getAllByRole("checkbox")).toHaveLength(1); // only Real has files
  });

  it("does not offer a cell that has no files", async () => {
    removeCounts.mockResolvedValue(COUNTS);
    renderDialog();
    await screen.findByRole("table");
    expect(screen.queryByRole("checkbox", { name: "English hearing impaired" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "English generated" })).toBeNull();
  });

  it("ticks nothing by default, and Remove stays off until something is ticked", async () => {
    removeCounts.mockResolvedValue(COUNTS);
    renderDialog();
    await screen.findByRole("table");
    for (const box of screen.getAllByRole("checkbox")) {
      expect(box.getAttribute("aria-checked")).toBe("false");
    }
    expect(removeButton().disabled).toBe(true);
    fireEvent.click(cell("Arabic", "real"));
    expect(removeButton().disabled).toBe(false);
    expect(removeButton().textContent).toMatch(/4 files/);
    fireEvent.click(cell("Arabic", "real"));
    expect(removeButton().disabled).toBe(true);
  });

  it("says what Real does not include", async () => {
    removeCounts.mockResolvedValue(COUNTS);
    renderDialog();
    await screen.findByRole("table");
    expect(screen.getByText(/Real does not include hearing impaired files/)).toBeTruthy();
  });

  it("asks before deleting, with the count, then removes what was ticked", async () => {
    removeCounts.mockResolvedValue(COUNTS);
    removeByKind.mockResolvedValue({ removed: 7 });
    const p = renderDialog();
    await screen.findByRole("table");
    fireEvent.click(cell("Arabic", "real"));
    fireEvent.click(cell("English", "real"));
    expect(removeButton().textContent).toMatch(/7 files/);
    fireEvent.click(removeButton());
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toMatch(/7 subtitle files/);
    expect(removeByKind).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete files" }));
    await waitFor(() => expect(p.onRemoved).toHaveBeenCalledWith(7));
    expect(removeByKind).toHaveBeenCalledWith(VIDEOS, [
      { language: "ar", kind: "real" },
      { language: "en", kind: "real" },
    ]);
  });

  it("removes nothing when the confirmation is cancelled", async () => {
    removeCounts.mockResolvedValue(COUNTS);
    const p = renderDialog();
    await screen.findByRole("table");
    fireEvent.click(cell("Arabic", "generated"));
    fireEvent.click(removeButton());
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(removeByKind).not.toHaveBeenCalled();
    expect(p.onRemoved).not.toHaveBeenCalled();
  });

  it("reads the scan and the files again after removing", async () => {
    removeCounts.mockResolvedValue(COUNTS);
    removeByKind.mockResolvedValue({ removed: 1 });
    const p = renderDialog();
    await screen.findByRole("table");
    fireEvent.click(cell("Arabic", "sync backups"));
    fireEvent.click(removeButton());
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete files" }),
    );
    await waitFor(() => expect(p.onRemoved).toHaveBeenCalled());
    const keys = p.invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["subtitles", "scan", "/tv"]));
    expect(keys).toContain(JSON.stringify(["subtitles", "files"]));
  });

  it("says when the videos have no subtitle files at all", async () => {
    removeCounts.mockResolvedValue({});
    renderDialog();
    expect(await screen.findByText("These videos have no subtitle files.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows why the counts could not be read, with a way to try again", async () => {
    removeCounts.mockRejectedValueOnce(new Error("500: boom")).mockResolvedValue(COUNTS);
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /Retry|Try again/ }));
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("splits a big selection into requests of 500 videos and adds the counts up", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => `/tv/v${i}.mkv`);
    removeCounts.mockResolvedValue({ ar: { real: 2 } });
    removeByKind.mockResolvedValue({ removed: 3 });
    const p = renderDialog({ videoPaths: many });
    await screen.findByRole("table");
    expect(removeCounts.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([500, 500, 200]);
    expect(within(screen.getByRole("row", { name: /Arabic/ })).getByText("6")).toBeTruthy();
    fireEvent.click(cell("Arabic", "real"));
    fireEvent.click(removeButton());
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete files" }),
    );
    await waitFor(() => expect(p.onRemoved).toHaveBeenCalledWith(9));
    expect(removeByKind.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([500, 500, 200]);
  });

  it("reads nothing while it is closed", () => {
    renderDialog({ open: false });
    expect(removeCounts).not.toHaveBeenCalled();
  });

  it("starts from nothing ticked every time it opens", async () => {
    removeCounts.mockResolvedValue(COUNTS);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const make = (open: boolean) => (
      <QueryClientProvider client={qc}>
        <ConfirmProvider>
          <RemoveSubtitlesDialog
            open={open}
            folder="/tv"
            videoPaths={VIDEOS}
            onClose={vi.fn()}
            onRemoved={vi.fn()}
          />
        </ConfirmProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(make(true));
    await screen.findByRole("table");
    fireEvent.click(cell("Arabic", "real"));
    rerender(make(false));
    rerender(make(true));
    await screen.findByRole("table");
    expect(cell("Arabic", "real").getAttribute("aria-checked")).toBe("false");
  });
});
