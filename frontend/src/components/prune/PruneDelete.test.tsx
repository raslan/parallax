// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      pruneDelete: vi.fn(),
      pruneDeleteFolder: vi.fn(),
    },
  };
});

import { toast } from "sonner";
import { api } from "@/lib/api";
import { DeleteFilesDialog } from "@/components/prune/DeleteFilesDialog";
import { DeleteFolderDialog } from "@/components/prune/DeleteFolderDialog";
import { EmptyFolderPrompt } from "@/components/prune/EmptyFolderPrompt";
import { removeDeleted, selectedIn } from "@/lib/pruneSelect";
import type { Counts, PruneDeleteResult, PruneFile } from "@/types/prune";

const file = (name: string, size = 1000): PruneFile => ({
  name,
  path: `/r/${name}`,
  kind: "video",
  size,
  mtime: 0,
});

const counts: Counts = { files: 12, images: 2, videos: 8, audio: 1, other: 1, bytes: 5_000_000 };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("DeleteFolderDialog", () => {
  const folder = { name: "Season 1", path: "/r/Season 1", total: counts };

  it("keeps Delete disabled until the checkbox is ticked", () => {
    render(<DeleteFolderDialog folder={folder} onClose={() => {}} onDeleted={() => {}} />);
    const del = screen.getByRole("button", { name: "Delete folder" }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /i'm sure/i }));
    expect(del.disabled).toBe(false);
  });

  it("states the totals and that hidden entries and symlinks go too", () => {
    render(<DeleteFolderDialog folder={folder} onClose={() => {}} onDeleted={() => {}} />);
    expect(screen.getByText(/12 files/)).toBeTruthy();
    expect(screen.getByText(/hidden/i)).toBeTruthy();
    expect(screen.getByText(/symlink/i)).toBeTruthy();
  });

  it("resets the checkbox when reopened", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen((o) => !o)}>toggle</button>
          <DeleteFolderDialog
            folder={open ? folder : null}
            onClose={() => setOpen(false)}
            onDeleted={() => {}}
          />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox", { name: /i'm sure/i }));
    fireEvent.click(screen.getByText("toggle")); // close
    fireEvent.click(screen.getByText("toggle")); // reopen
    const del = screen.getByRole("button", { name: "Delete folder" }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });

  it("reports success to the caller", async () => {
    vi.mocked(api.pruneDeleteFolder).mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    render(<DeleteFolderDialog folder={folder} onClose={() => {}} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /i'm sure/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("/r/Season 1"));
  });

  it("tells the caller when the delete failed", async () => {
    vi.mocked(api.pruneDeleteFolder).mockRejectedValue(new Error("500: partial"));
    const onFailed = vi.fn();
    render(
      <DeleteFolderDialog
        folder={folder}
        onClose={() => {}}
        onDeleted={() => {}}
        onFailed={onFailed}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /i'm sure/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("DeleteFilesDialog", () => {
  const files = Array.from({ length: 10 }, (_, i) => file(`clip-${i}.mp4`));

  it("lists up to 8 names, the total and the warning", () => {
    render(<DeleteFilesDialog files={files} onClose={() => {}} onResult={() => {}} />);
    expect(screen.getByText("clip-7.mp4")).toBeTruthy();
    expect(screen.queryByText("clip-8.mp4")).toBeNull();
    expect(screen.getByText(/and 2 more/i)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
  });

  it("reports failures and leaves failed paths selected", async () => {
    const result: PruneDeleteResult = {
      deleted: ["/r/clip-0.mp4", "/r/clip-1.mp4"],
      failed: [{ path: "/r/clip-2.mp4", error: "permission denied" }],
      empty_folders: [],
    };
    vi.mocked(api.pruneDelete).mockResolvedValue(result);
    const selection = new Set(["/r/clip-0.mp4", "/r/clip-1.mp4", "/r/clip-2.mp4"]);
    let after = selection;
    const onResult = vi.fn((r: PruneDeleteResult) => {
      after = removeDeleted(selection, r.deleted);
    });
    render(<DeleteFilesDialog files={files.slice(0, 3)} onClose={() => {}} onResult={onResult} />);
    fireEvent.click(screen.getByRole("button", { name: /^Delete 3 files$/ }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
    expect(api.pruneDelete).toHaveBeenCalledWith([
      "/r/clip-0.mp4",
      "/r/clip-1.mp4",
      "/r/clip-2.mp4",
    ]);
    expect([...after]).toEqual(["/r/clip-2.mp4"]);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe("DeleteFilesDialog with a filter hiding selected files", () => {
  it("counts and sends only selected files that are visible", async () => {
    vi.mocked(api.pruneDelete).mockResolvedValue({ deleted: [], failed: [], empty_folders: [] });
    const all = Array.from({ length: 5 }, (_, i) => file(`f-${i}.mp4`));
    const visible = all.slice(1, 3); // filter shows f-1, f-2 only
    const selection = new Set(all.map((x) => x.path)); // everything selected
    const shown = selectedIn(visible, selection);
    render(<DeleteFilesDialog files={shown} onClose={() => {}} onResult={() => {}} />);
    expect(screen.getByText("Delete 2 files?")).toBeTruthy();
    expect(screen.queryByText("f-0.mp4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Delete 2 files$/ }));
    await waitFor(() => expect(api.pruneDelete).toHaveBeenCalledWith(["/r/f-1.mp4", "/r/f-2.mp4"]));
  });
});

describe("EmptyFolderPrompt", () => {
  it("prompts once per empty folder, in order", async () => {
    vi.mocked(api.pruneDeleteFolder).mockResolvedValue(undefined);
    const onResolve = vi.fn();
    const onClose = vi.fn();
    render(<EmptyFolderPrompt paths={["/r/a", "/r/b"]} onResolve={onResolve} onClose={onClose} />);
    expect(screen.getByText(/Folder is now empty/i)).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.getByText("b")).toBeTruthy());
    expect(onResolve).toHaveBeenCalledWith("/r/a", false);
    expect(api.pruneDeleteFolder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("/r/b", true));
    expect(api.pruneDeleteFolder).toHaveBeenCalledWith("/r/b");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
