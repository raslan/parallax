// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, pruneStreamPrepare: vi.fn(), pruneStreamPrepareStatus: vi.fn() },
    streamApi: { prepare: vi.fn(), status: vi.fn() },
  };
});
vi.mock("@/components/VideoJsPlayer", () => ({ default: () => <div /> }));
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

import { api, streamApi } from "@/lib/api";
import { FileBrowser } from "@/components/prune/FileBrowser";
import type { PruneFile } from "@/types/prune";

const video: PruneFile = { name: "a.mkv", path: "/r/a.mkv", kind: "video", size: 10, mtime: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.pruneStreamPrepare).mockResolvedValue({
    status: "ready",
    progress: 100,
    error: null,
    mode: "direct",
    url: null,
  });
});
afterEach(cleanup);

describe("FileBrowser image details", () => {
  it("shows W×H in the meta line of an image", () => {
    const img: PruneFile = { name: "p.jpg", path: "/r/p.jpg", kind: "image", size: 10, mtime: 0 };
    render(
      <FileBrowser
        files={[img]}
        details={{
          "/r/p.jpg": { duration: null, width: 4000, height: 3000, codec: "jpeg", bitrate: null },
        }}
        progress={{ loaded: 1, total: 1, done: true }}
        viewMode="list"
        cardSize={240}
      />,
    );
    expect(screen.getByText("4000×3000 · jpeg")).toBeTruthy();
  });
});

describe("FileBrowser video preview", () => {
  it("prepares through the sandboxed prune route, never the library one", async () => {
    render(
      <FileBrowser
        files={[video]}
        details={{}}
        progress={{ loaded: 0, total: 0, done: true }}
        viewMode="list"
        cardSize={240}
      />,
    );
    fireEvent.click(screen.getByTitle("Play"));
    await waitFor(() => expect(api.pruneStreamPrepare).toHaveBeenCalledWith("/r/a.mkv"));
    expect(streamApi.prepare).not.toHaveBeenCalled();
  });
});

describe("FileBrowser grid uses the shared card", () => {
  const renderGrid = (files: PruneFile[], onToggleSelect = vi.fn()) =>
    render(
      <FileBrowser
        files={files}
        details={{}}
        progress={{ loaded: 0, total: 0, done: true }}
        viewMode="grid"
        cardSize={240}
        selected={new Set()}
        onToggleSelect={onToggleSelect}
      />,
    );

  it("toggles selection on a card body click without opening the preview", () => {
    const onToggleSelect = vi.fn();
    renderGrid([video], onToggleSelect);
    fireEvent.click(screen.getByText("a.mkv"));
    expect(onToggleSelect).toHaveBeenCalledWith(video);
    expect(api.pruneStreamPrepare).not.toHaveBeenCalled();
  });

  it("opens the preview from the play button without toggling", async () => {
    const onToggleSelect = vi.fn();
    renderGrid([video], onToggleSelect);
    fireEvent.click(screen.getByTitle("Preview"));
    await waitFor(() => expect(api.pruneStreamPrepare).toHaveBeenCalledWith("/r/a.mkv"));
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it("gives non-media files no play button in grid or list", () => {
    const doc: PruneFile = { name: "n.txt", path: "/r/n.txt", kind: "other", size: 3, mtime: 0 };
    renderGrid([doc]);
    expect(screen.queryByTitle("Preview")).toBeNull();
    cleanup();
    render(
      <FileBrowser
        files={[doc]}
        details={{}}
        progress={{ loaded: 0, total: 0, done: true }}
        viewMode="list"
        cardSize={240}
      />,
    );
    expect(screen.queryByTitle("Play")).toBeNull();
  });
});
