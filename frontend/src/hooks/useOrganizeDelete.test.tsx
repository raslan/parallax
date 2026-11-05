// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "t"),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, organizeDelete: vi.fn(), organizeDeleteFolder: vi.fn() },
  };
});

import { toast } from "sonner";
import { api } from "@/lib/api";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { removeDeleted, selectedIn } from "@/lib/organizeSelect";
import type { Counts, OrganizeDeleteResult, OrganizeFile } from "@/types/organize";
import { useOrganizeDelete, type OrganizeDeleteHandlers } from "./useOrganizeDelete";

const file = (name: string, size = 1000): OrganizeFile => ({
  name,
  path: `/r/${name}`,
  kind: "video",
  size,
  mtime: 0,
});
const counts: Counts = { files: 12, images: 2, videos: 8, audio: 1, other: 1, bytes: 5_000_000 };
const folder = { name: "Season 1", path: "/r/Season 1", total: counts };

const wrapper = ({ children }: { children: ReactNode }) => (
  <ConfirmProvider>{children}</ConfirmProvider>
);

function setup(over: Partial<OrganizeDeleteHandlers> = {}) {
  const handlers: OrganizeDeleteHandlers = {
    onFilesResult: vi.fn(),
    onFilesError: vi.fn(),
    onEmptyFolderDeleted: vi.fn(),
    onFolderDeleted: vi.fn(),
    onFolderFailed: vi.fn(),
    onGone: vi.fn(),
    ...over,
  };
  const hook = renderHook(() => useOrganizeDelete(handlers), { wrapper });
  return { handlers, hook };
}

/** Starts a delete without awaiting it (the confirm dialog is waiting for a click). */
function start(fn: () => Promise<void>) {
  let done!: Promise<void>;
  act(() => {
    done = fn();
  });
  return done;
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("useOrganizeDelete: files", () => {
  const files = Array.from({ length: 10 }, (_, i) => file(`clip-${i}.mp4`));

  it("asks first: up to 8 names, the total and the warning", async () => {
    const { hook } = setup();
    start(() => hook.result.current.deleteFiles(files));
    expect(await screen.findByText("Delete 10 files?")).toBeTruthy();
    expect(screen.getByText("clip-7.mp4")).toBeTruthy();
    expect(screen.queryByText("clip-8.mp4")).toBeNull();
    expect(screen.getByText(/and 2 more/i)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(screen.getByText("10 files (9.8 KB)")).toBeTruthy();
  });

  it("does nothing when cancelled", async () => {
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFiles(files));
    click("Cancel");
    await act(() => done);
    expect(api.organizeDelete).not.toHaveBeenCalled();
    expect(handlers.onFilesResult).not.toHaveBeenCalled();
  });

  it("is busy while the call runs, then reports the result", async () => {
    let finish!: (r: OrganizeDeleteResult) => void;
    vi.mocked(api.organizeDelete).mockReturnValue(
      new Promise<OrganizeDeleteResult>((res) => {
        finish = res;
      }),
    );
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFiles(files.slice(0, 1)));
    click(/^Delete 1 file$/);
    await waitFor(() => expect(hook.result.current.deleting).toBe(true));
    const result = { deleted: ["/r/clip-0.mp4"], failed: [], empty_folders: [] };
    finish(result);
    await act(() => done);
    expect(hook.result.current.deleting).toBe(false);
    expect(handlers.onFilesResult).toHaveBeenCalledWith(result);
    expect(toast.success).toHaveBeenCalledWith("Deleted 1 file");
  });

  it("toasts failures once and leaves the failed paths selected", async () => {
    const result: OrganizeDeleteResult = {
      deleted: ["/r/clip-0.mp4", "/r/clip-1.mp4"],
      failed: [{ path: "/r/clip-2.mp4", error: "permission denied" }],
      empty_folders: [],
    };
    vi.mocked(api.organizeDelete).mockResolvedValue(result);
    const selection = new Set(["/r/clip-0.mp4", "/r/clip-1.mp4", "/r/clip-2.mp4"]);
    let after = selection;
    const { hook } = setup({
      onFilesResult: (r) => {
        after = removeDeleted(selection, r.deleted);
      },
    });
    const done = start(() => hook.result.current.deleteFiles(files.slice(0, 3)));
    click(/^Delete 3 files$/);
    await act(() => done);
    expect(api.organizeDelete).toHaveBeenCalledWith([
      "/r/clip-0.mp4",
      "/r/clip-1.mp4",
      "/r/clip-2.mp4",
    ]);
    expect([...after]).toEqual(["/r/clip-2.mp4"]);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("deletes a big selection in chunks of 500, counting progress, with one merged result", async () => {
    // Hold the second chunk so the "N / M" progress can be read mid-run.
    let second!: () => void;
    vi.mocked(api.organizeDelete)
      .mockImplementationOnce(async (paths) => ({ deleted: paths, failed: [], empty_folders: [] }))
      .mockImplementationOnce(
        (paths) =>
          new Promise((res) => {
            second = () => res({ deleted: paths, failed: [], empty_folders: [] });
          }),
      )
      .mockImplementationOnce(async (paths) => ({ deleted: paths, failed: [], empty_folders: [] }));
    const many = Array.from({ length: 1100 }, (_, i) => file(`m-${i}.mp4`));
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFiles(many));
    click(/^Delete 1100 files$/);
    await waitFor(() => expect(hook.result.current.progress).toEqual({ sent: 500, total: 1100 }));
    second();
    await act(() => done);
    expect(vi.mocked(api.organizeDelete).mock.calls.map((c) => c[0].length)).toEqual([
      500, 500, 100,
    ]);
    const merged = vi.mocked(handlers.onFilesResult).mock.calls[0]![0];
    expect(merged.deleted).toHaveLength(1100);
    expect(hook.result.current.progress).toBeNull();
  });

  it("stops on a 409 mid-way, keeping what was deleted, and reports the root gone", async () => {
    vi.mocked(api.organizeDelete)
      .mockImplementationOnce(async (paths) => ({ deleted: paths, failed: [], empty_folders: [] }))
      .mockRejectedValueOnce(new Error("409: Folder is no longer available"));
    const many = Array.from({ length: 1100 }, (_, i) => file(`m-${i}.mp4`));
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFiles(many));
    click(/^Delete 1100 files$/);
    await act(() => done);
    expect(api.organizeDelete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(handlers.onFilesResult).mock.calls[0]![0].deleted).toHaveLength(500);
    expect(handlers.onGone).toHaveBeenCalled();
    expect(handlers.onFilesError).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("refreshes after a network failure", async () => {
    vi.mocked(api.organizeDelete).mockRejectedValue(new Error("Failed to fetch"));
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFiles(files.slice(0, 1)));
    click(/^Delete 1 file$/);
    await act(() => done);
    expect(handlers.onFilesError).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("only counts and sends the selected files that are visible", async () => {
    vi.mocked(api.organizeDelete).mockResolvedValue({ deleted: [], failed: [], empty_folders: [] });
    const all = Array.from({ length: 5 }, (_, i) => file(`f-${i}.mp4`));
    const shown = selectedIn(all.slice(1, 3), new Set(all.map((x) => x.path)));
    const { hook } = setup();
    const done = start(() => hook.result.current.deleteFiles(shown));
    expect(await screen.findByText("Delete 2 files?")).toBeTruthy();
    expect(screen.queryByText("f-0.mp4")).toBeNull();
    click(/^Delete 2 files$/);
    await act(() => done);
    expect(api.organizeDelete).toHaveBeenCalledWith(["/r/f-1.mp4", "/r/f-2.mp4"]);
  });
});

describe("useOrganizeDelete: empty folders left behind", () => {
  it("asks once per empty folder, in order, sending only_if_empty", async () => {
    vi.mocked(api.organizeDelete).mockResolvedValue({
      deleted: ["/r/a/x.mp4"],
      failed: [],
      empty_folders: ["/r/a", "/r/b"],
    });
    vi.mocked(api.organizeDeleteFolder).mockResolvedValue(undefined);
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFiles([file("a/x.mp4")]));
    click(/^Delete 1 file$/);
    expect(await screen.findByText("Empty folder (1 of 2)")).toBeTruthy();
    expect(screen.getByText(/Folder is now empty/i)).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();
    click("Keep");
    expect(await screen.findByText("Empty folder (2 of 2)")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    expect(api.organizeDeleteFolder).not.toHaveBeenCalled();
    click("Delete");
    await act(() => done);
    expect(api.organizeDeleteFolder).toHaveBeenCalledWith("/r/b", true);
    expect(handlers.onEmptyFolderDeleted).toHaveBeenCalledTimes(1);
    expect(handlers.onEmptyFolderDeleted).toHaveBeenCalledWith("/r/b");
  });

  it("keeps a folder that is no longer empty, with a friendly note", async () => {
    vi.mocked(api.organizeDelete).mockResolvedValue({
      deleted: ["/r/a/x.mp4"],
      failed: [],
      empty_folders: ["/r/a"],
    });
    vi.mocked(api.organizeDeleteFolder).mockRejectedValue(
      new Error('409: {"detail":"Folder is no longer empty"}'),
    );
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFiles([file("a/x.mp4")]));
    click(/^Delete 1 file$/);
    expect(await screen.findByText("Empty folder")).toBeTruthy();
    click("Delete");
    await act(() => done);
    expect(handlers.onEmptyFolderDeleted).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Folder isn't empty any more — kept");
  });
});

describe("useOrganizeDelete: a whole folder", () => {
  it("states the totals, warns about hidden entries and symlinks, gates on I'm sure", async () => {
    vi.mocked(api.organizeDeleteFolder).mockResolvedValue(undefined);
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFolder(folder));
    expect(await screen.findByText("Delete this folder?")).toBeTruthy();
    expect(screen.getByText(/12 files/)).toBeTruthy();
    expect(screen.getByText(/hidden/i)).toBeTruthy();
    expect(screen.getByText(/symlink/i)).toBeTruthy();
    const del = screen.getByRole("button", { name: "Delete folder" }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /i'm sure/i }));
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    await act(() => done);
    expect(api.organizeDeleteFolder).toHaveBeenCalledWith("/r/Season 1");
    expect(handlers.onFolderDeleted).toHaveBeenCalledWith("/r/Season 1");
  });

  it("starts unticked every time it is asked", async () => {
    const { hook } = setup();
    const first = start(() => hook.result.current.deleteFolder(folder));
    fireEvent.click(await screen.findByRole("checkbox", { name: /i'm sure/i }));
    click("Cancel");
    await act(() => first);
    start(() => hook.result.current.deleteFolder(folder));
    const del = (await screen.findByRole("button", { name: "Delete folder" })) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });

  it("tells the page when the delete failed so it rescans", async () => {
    vi.mocked(api.organizeDeleteFolder).mockRejectedValue(new Error("500: partial"));
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFolder(folder));
    fireEvent.click(await screen.findByRole("checkbox", { name: /i'm sure/i }));
    click("Delete folder");
    await act(() => done);
    expect(handlers.onFolderFailed).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("reports the root gone on a 409", async () => {
    vi.mocked(api.organizeDeleteFolder).mockRejectedValue(new Error("409: gone"));
    const { hook, handlers } = setup();
    const done = start(() => hook.result.current.deleteFolder(folder));
    fireEvent.click(await screen.findByRole("checkbox", { name: /i'm sure/i }));
    click("Delete folder");
    await act(() => done);
    expect(handlers.onGone).toHaveBeenCalled();
    expect(handlers.onFolderFailed).not.toHaveBeenCalled();
  });
});
