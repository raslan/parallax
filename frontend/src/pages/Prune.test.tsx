// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getPruneRoot: vi.fn(),
      putPruneRoot: vi.fn(),
      startPruneScan: vi.fn(),
      getPruneScan: vi.fn(),
      getPruneFolder: vi.fn(),
      getPruneFiles: vi.fn(),
      getPruneDetails: vi.fn(),
      pruneDeleteFolder: vi.fn(),
    },
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
// The real picker is a DirPicker dialog; the tests only need "a folder was chosen".
vi.mock("@/components/prune/PruneFolderPicker", () => ({
  PruneFolderPicker: ({ open, onSelect }: { open: boolean; onSelect: (p: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onSelect("/new")}>
        pick /new
      </button>
    ) : null,
}));

// Radix Slider (the card-size control) reads ResizeObserver, absent from jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
// NameGroupChips' module worker never answers here; the chips are not under test.
class WorkerStub {
  onmessage = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.stubGlobal("Worker", WorkerStub);
// jsdom has no element scrolling; the page scrolls its scroller to the top on navigation.
const scrollTo = vi.fn();
Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];

import { api } from "@/lib/api";
import { Prune } from "./Prune";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import type { PruneFolder } from "@/types/prune";

const ZERO = { files: 0, images: 0, videos: 0, audio: 0, other: 0, bytes: 0 };
const SOME = { ...ZERO, files: 1, other: 1, bytes: 10 };

/** /r → a → b, plus "사진 & #1" under the root; anything else is a 404. */
const TREE: Record<string, string[]> = {
  "/r": ["/r/a", "/r/사진 & #1"],
  "/r/a": ["/r/a/b"],
  "/r/a/b": [],
  "/r/사진 & #1": [],
  "/new": [],
};

function folder(path: string): PruneFolder {
  const root = path.startsWith("/new") ? "/new" : "/r";
  const parts = path.slice(root.length).split("/").filter(Boolean);
  const crumbs = [{ name: root.slice(1), path: root }];
  let acc = root;
  for (const p of parts) {
    acc = `${acc}/${p}`;
    crumbs.push({ name: p, path: acc });
  }
  const name = crumbs[crumbs.length - 1]!.name;
  return {
    path,
    name,
    parent: crumbs.length > 1 ? crumbs[crumbs.length - 2]!.path : null,
    breadcrumbs: crumbs,
    direct: ZERO,
    total: SOME,
    subfolders: (TREE[path] ?? []).map((p) => ({
      name: p.slice(p.lastIndexOf("/") + 1),
      path: p,
      direct: ZERO,
      total: SOME,
    })),
  };
}

let root = "/r";
beforeEach(() => {
  vi.clearAllMocks();
  root = "/r";
  vi.mocked(api.getPruneRoot).mockImplementation(async () => ({ root }));
  vi.mocked(api.putPruneRoot).mockImplementation(async (p: string) => {
    root = p;
    return { root };
  });
  const done = async () => ({ status: "done" as const, folders_scanned: 4, root });
  vi.mocked(api.startPruneScan).mockImplementation(done);
  vi.mocked(api.getPruneScan).mockImplementation(done);
  vi.mocked(api.getPruneFolder).mockImplementation(async (p: string) => {
    if (!(p in TREE)) throw new Error("404: Folder not found");
    return folder(p);
  });
  vi.mocked(api.getPruneFiles).mockResolvedValue([]);
  vi.mocked(api.pruneDeleteFolder).mockResolvedValue(undefined);
});
afterEach(cleanup);

/** Shows the router location and offers the browser's Back. */
function Probe() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="loc">{`${loc.pathname}${loc.search}`}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        browser back
      </button>
    </>
  );
}

function renderAt(entries: string[]) {
  // The app's 30 s staleTime (lib/queryClient.ts): coming Back reuses cached listings.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
          <Routes>
            <Route path="/prune" element={<Prune />} />
            <Route path="*" element={null} />
          </Routes>
          <Probe />
        </MemoryRouter>
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

const loc = () => screen.getByTestId("loc").textContent;
const crumbs = () => screen.getByRole("navigation", { name: "Folder path" });
const current = async (name: string) =>
  waitFor(() => expect(within(crumbs()).getByText(name).getAttribute("aria-current")).toBe("page"));

describe("Prune URL navigation", () => {
  it("opens the folder named by ?path=", async () => {
    renderAt(["/prune?path=/r/a"]);
    await current("a");
    expect(api.getPruneFolder).toHaveBeenCalledWith("/r/a");
  });

  it("decodes encoded names (Korean, &, #, spaces)", async () => {
    renderAt([`/prune?path=${encodeURIComponent("/r/사진 & #1")}`]);
    await current("사진 & #1");
  });

  it("opening a folder pushes an entry and Back returns without a rescan", async () => {
    renderAt(["/prune"]);
    await current("r");
    const card = await screen.findByRole("link", { name: /^a/ });
    expect(card.getAttribute("href")).toBe("/prune?path=/r/a");
    fireEvent.click(card);
    await current("a");
    expect(loc()).toBe("/prune?path=/r/a");

    fireEvent.click(screen.getByRole("link", { name: /^b/ }));
    await current("b");
    expect(loc()).toBe("/prune?path=/r/a/b");

    fireEvent.click(screen.getByText("browser back"));
    await current("a");
    expect(loc()).toBe("/prune?path=/r/a");
    fireEvent.click(screen.getByText("browser back"));
    await current("r");
    expect(loc()).toBe("/prune");

    // One non-forced scan on mount; walking history reuses it and the cached listings.
    expect(api.startPruneScan).toHaveBeenCalledTimes(1);
    expect(api.startPruneScan).toHaveBeenCalledWith(false);
    expect(vi.mocked(api.getPruneFolder).mock.calls.filter(([p]) => p === "/r")).toHaveLength(1);
  });

  it("leaving a folder clears the selection and scrolls to the top", async () => {
    const withFile = { ...folder("/r/a"), direct: { ...ZERO, files: 1, other: 1, bytes: 10 } };
    vi.mocked(api.getPruneFolder).mockImplementation(async (p: string) =>
      p === "/r/a" ? withFile : folder(p),
    );
    vi.mocked(api.getPruneFiles).mockResolvedValue([
      { name: "x.txt", path: "/r/a/x.txt", kind: "other", size: 10, mtime: 0 },
    ]);
    renderAt(["/prune?path=/r/a"]);
    fireEvent.click(await screen.findByText("x.txt"));
    expect(await screen.findByText(/1 selected/)).toBeTruthy();

    scrollTo.mockClear();
    fireEvent.click(screen.getByRole("link", { name: /^b/ }));
    await current("b");
    expect(screen.queryByText(/1 selected/)).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });

    fireEvent.click(screen.getByText("browser back"));
    await current("a");
    await screen.findByText("x.txt");
    expect(screen.queryByText(/1 selected/)).toBeNull();
  });

  it("breadcrumbs are links that push", async () => {
    renderAt(["/prune?path=/r/a/b"]);
    await current("b");
    const up = within(crumbs()).getByRole("link", { name: "a" });
    expect(up.getAttribute("href")).toBe("/prune?path=/r/a");
    expect(within(crumbs()).getByRole("link", { name: "r" }).getAttribute("href")).toBe("/prune");
    fireEvent.click(up);
    await current("a");
    fireEvent.click(screen.getByText("browser back"));
    await current("b");
  });

  it.each([
    ["outside the root", "/prune?path=/etc"],
    ["malformed", "/prune?path=r/../x"],
    ["deleted", "/prune?path=/r/gone"],
  ])("a path %s shows the gone state; its root link replaces the entry", async (_, url) => {
    renderAt(["/before", url]);
    const back = await screen.findByRole("link", { name: /Back to the top folder/ });
    expect(back.getAttribute("href")).toBe("/prune");
    fireEvent.click(back);
    await current("r");
    expect(loc()).toBe("/prune");
    fireEvent.click(screen.getByText("browser back"));
    await waitFor(() => expect(loc()).toBe("/before"));
  });

  it("changing the root clears the path param without a history entry", async () => {
    renderAt(["/before", "/prune?path=/r/a"]);
    await current("a");
    fireEvent.click(screen.getByRole("button", { name: /Change folder/ }));
    fireEvent.click(screen.getByText("pick /new"));
    await current("new");
    expect(loc()).toBe("/prune");
    fireEvent.click(screen.getByText("browser back"));
    await waitFor(() => expect(loc()).toBe("/before"));
  });

  it("deleting the open folder replaces it with its parent", async () => {
    renderAt(["/before", "/prune?path=/r/a/b"]);
    await current("b");
    fireEvent.click(within(crumbs()).getByRole("button", { name: "Delete b" }));
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await waitFor(() => expect(api.pruneDeleteFolder).toHaveBeenCalledWith("/r/a/b"));
    await current("a");
    expect(loc()).toBe("/prune?path=/r/a");
    fireEvent.click(screen.getByText("browser back"));
    await waitFor(() => expect(loc()).toBe("/before"));
  });
});
