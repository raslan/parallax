// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, organizeStreamPrepare: vi.fn(), organizeStreamPrepareStatus: vi.fn() },
    streamApi: { prepare: vi.fn(), status: vi.fn() },
  };
});
vi.mock("@/components/VideoJsPlayer", () => ({ default: () => <div /> }));
vi.mock("@/components/VideoJsAudioPlayer", () => ({ default: () => <div /> }));
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
import { FileBrowser } from "@/components/organize/FileBrowser";
import type { OrganizeFile } from "@/types/organize";

const video: OrganizeFile = { name: "a.mkv", path: "/r/a.mkv", kind: "video", size: 10, mtime: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.organizeStreamPrepare).mockResolvedValue({
    status: "ready",
    progress: 100,
    error: null,
    mode: "direct",
    url: null,
  });
});
afterEach(cleanup);

describe("FileBrowser image details", () => {
  const img: OrganizeFile = { name: "p.jpg", path: "/r/p.jpg", kind: "image", size: 10, mtime: 0 };
  const details = {
    "/r/p.jpg": { duration: null, width: 4000, height: 3000, codec: "jpeg", bitrate: null },
  };
  it("shows W×H in the meta line of an image card", () => {
    render(
      <FileBrowser
        files={[img]}
        details={details}
        progress={{ loaded: 1, total: 1, done: true }}
        viewMode="grid"
        cardSize={240}
      />,
    );
    expect(screen.getByText("4000×3000 · jpeg")).toBeTruthy();
  });
  it("shows each detail in its own list column", () => {
    render(
      <FileBrowser
        files={[img]}
        details={details}
        progress={{ loaded: 1, total: 1, done: true }}
        viewMode="list"
        cardSize={240}
      />,
    );
    expect(screen.getByText("4000×3000")).toBeTruthy();
    expect(screen.getByText("jpeg")).toBeTruthy();
  });
});

describe("FileBrowser sorting", () => {
  const props = {
    files: [video],
    details: {},
    progress: { loaded: 0, total: 0, done: true },
    cardSize: 240,
  };
  it("gives the list a sortable column header that follows the row columns", () => {
    const onSort = vi.fn();
    render(<FileBrowser {...props} viewMode="list" sortKey="name" sortDir="asc" onSort={onSort} />);
    expect(screen.getByRole("button", { name: "Sort by Name, ascending" })).toBeTruthy();
    for (const col of ["Added", "Duration", "Resolution", "Codec", "Bitrate", "Size"]) {
      expect(screen.getByRole("button", { name: `Sort by ${col}` })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Sort by Duration" }));
    expect(onSort).toHaveBeenCalledWith("duration");
  });
  it("has no sort picker of its own (it lives in BrowseControls)", () => {
    render(
      <FileBrowser {...props} viewMode="grid" sortKey="size" sortDir="desc" onSort={vi.fn()} />,
    );
    expect(screen.queryByRole("combobox", { name: "Sort files" })).toBeNull();
  });
  it("shows no sort controls without onSort", () => {
    render(<FileBrowser {...props} viewMode="list" />);
    expect(screen.queryByRole("button", { name: /^Sort by/ })).toBeNull();
  });
});

describe("FileBrowser redact", () => {
  const props = { files: [video], details: {}, progress: { loaded: 0, total: 0, done: true } };
  it("replaces file names and drops thumbnails in both views", () => {
    for (const viewMode of ["grid", "list"] as const) {
      const { container } = render(
        <FileBrowser {...props} viewMode={viewMode} cardSize={240} redact />,
      );
      expect(screen.getByText("Redacted file")).toBeTruthy();
      expect(screen.queryByText("a.mkv")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      cleanup();
    }
  });
  it("shows the real name and a thumbnail otherwise", () => {
    const { container } = render(<FileBrowser {...props} viewMode="grid" cardSize={240} />);
    expect(screen.getByText("a.mkv")).toBeTruthy();
    expect(container.querySelector("img")).not.toBeNull();
  });
});

describe("FileBrowser video preview", () => {
  it("prepares through the sandboxed organize route, never the library one", async () => {
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
    await waitFor(() => expect(api.organizeStreamPrepare).toHaveBeenCalledWith("/r/a.mkv"));
    expect(streamApi.prepare).not.toHaveBeenCalled();
  });
});

describe("FileBrowser audio preview", () => {
  const play = (name: string) => {
    const song: OrganizeFile = { name, path: `/r/${name}`, kind: "audio", size: 10, mtime: 0 };
    render(
      <FileBrowser
        files={[song]}
        details={{}}
        progress={{ loaded: 0, total: 0, done: true }}
        viewMode="list"
        cardSize={240}
      />,
    );
    fireEvent.click(screen.getByTitle("Play"));
  };

  it("plays a browser-native format straight from the file, whatever its case", () => {
    const fileUrl = vi.spyOn(api, "organizeFileUrl");
    const audioUrl = vi.spyOn(api, "organizeAudioUrl");
    play("Song.MP3");
    expect(fileUrl).toHaveBeenCalledWith("/r/Song.MP3");
    expect(audioUrl).not.toHaveBeenCalled();
  });

  it("sends any other audio through the transcoding route", () => {
    const audioUrl = vi.spyOn(api, "organizeAudioUrl");
    play("old.wma");
    expect(audioUrl).toHaveBeenCalledWith("/r/old.wma");
  });
});

describe("FileBrowser details shimmer", () => {
  it("lays the loading shimmer out like the details it stands in for", () => {
    const { container } = render(
      <FileBrowser
        files={[video]}
        details={{}}
        progress={{ loaded: 0, total: 1, done: false }}
        viewMode="list"
        cardSize={240}
      />,
    );
    // The list's details column is hidden on phones; its shimmer must be too.
    const shimmer = container.querySelector('div[aria-hidden="true"].bg-muted');
    expect(shimmer?.className).toContain("sm:block");
  });

  it("shows how far details have got on the shared progress bar", () => {
    render(
      <FileBrowser
        files={[video]}
        details={{}}
        progress={{ loaded: 1, total: 4, done: false }}
        viewMode="list"
        cardSize={240}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Loading file details" });
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(screen.getByText("details 1 / 4")).toBeTruthy();
  });
});

describe("FileBrowser grid uses the shared card", () => {
  const renderGrid = (files: OrganizeFile[], onToggleSelect = vi.fn()) =>
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
    expect(api.organizeStreamPrepare).not.toHaveBeenCalled();
  });

  it("opens the preview from the play button without toggling", async () => {
    const onToggleSelect = vi.fn();
    renderGrid([video], onToggleSelect);
    fireEvent.click(screen.getByTitle("Preview"));
    await waitFor(() => expect(api.organizeStreamPrepare).toHaveBeenCalledWith("/r/a.mkv"));
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it("gives non-media files no play button in grid or list", () => {
    const doc: OrganizeFile = { name: "n.txt", path: "/r/n.txt", kind: "other", size: 3, mtime: 0 };
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
