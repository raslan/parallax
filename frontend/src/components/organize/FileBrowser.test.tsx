// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

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
vi.mock("@/components/VideoPlayerModal", () => ({ VideoPlayerModal: () => null }));
vi.mock("@/components/ImageViewerModal", () => ({ ImageViewerModal: () => null }));

import { FileBrowser } from "./FileBrowser";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

afterEach(cleanup);

const file = (name: string): OrganizeFile => ({
  name,
  path: `/r/${name}`,
  kind: "audio",
  size: 1000,
  mtime: 0,
});

const info = (fields: Record<string, string>): OrganizeTagInfo => ({
  fields,
  raw: fields,
  streams: [],
  truncated: false,
});

const NOISE = `#tag line one\n#more tags\n${"#hash ".repeat(200)}`;

const base = {
  files: [file("a.mp3"), file("b.mp3")],
  details: {},
  progress: { loaded: 2, total: 2, done: true },
  viewMode: "list" as const,
  cardSize: 240,
  sortKey: "name" as const,
  sortDir: "asc" as const,
  onSort: vi.fn(),
  tagColumns: ["description" as const],
  tags: {
    "/r/a.mp3": info({ description: NOISE }),
    "/r/b.mp3": null,
  },
  tagsLoading: false,
};

describe("FileBrowser tag columns (list view)", () => {
  it("shows a long multi-line description as one truncated line", () => {
    render(<FileBrowser {...base} />);
    const cell = screen.getByTestId("tag-description-/r/a.mp3");
    expect(cell.textContent).not.toContain("\n");
    expect(cell.className).toContain("truncate");
    expect(cell.textContent!.startsWith("#tag line one #more tags")).toBe(true);
  });

  it("lets tag columns share the row with the file name instead of a fixed width", () => {
    // Three fixed-width columns used to squeeze the name column down to nothing.
    render(<FileBrowser {...base} tagColumns={["title", "artist", "date"]} />);
    for (const id of ["title", "artist", "date"]) {
      const cls = screen.getByTestId(`tag-${id}-/r/a.mp3`).className;
      expect(cls).toContain("flex-1");
      expect(cls).toContain("min-w-0");
      expect(cls).not.toMatch(/(^|\s)w-\d+/);
    }
  });

  it("shows a dash for a file with no tags", () => {
    render(<FileBrowser {...base} />);
    expect(screen.getByTestId("tag-description-/r/b.mp3").textContent).toBe("—");
  });

  it("shows no value and no dash while the tags are still loading", () => {
    const { container } = render(<FileBrowser {...base} tags={{}} tagsLoading />);
    // Not even a dash: the cells are shimmering placeholders until the tags arrive.
    expect(container.querySelectorAll('[data-testid^="tag-"]')).toHaveLength(0);
  });

  it("puts no tag text anywhere in the page when redacting", () => {
    const { container } = render(<FileBrowser {...base} redact />);
    expect(screen.getAllByText("Redacted").length).toBeGreaterThan(0);
    // Not even the file's path, in an attribute or a hover title.
    expect(document.body.innerHTML).not.toContain("/r/a.mp3");
    expect(container.innerHTML).not.toContain("#tag line one");
    expect(document.body.innerHTML).not.toContain("#more tags");
  });

  it("sorts by a tag column header and leaves unsortable ones as plain labels", () => {
    const onSort = vi.fn();
    render(<FileBrowser {...base} onSort={onSort} tagColumns={["title", "comment"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Sort by Title/ }));
    expect(onSort).toHaveBeenCalledWith("tag_title");
    expect(screen.queryByRole("button", { name: /Sort by Comment/ })).toBeNull();
    expect(screen.getByText("Comment")).toBeTruthy();
  });

  it("shows no tag column at all when none is chosen", () => {
    render(<FileBrowser {...base} tagColumns={[]} />);
    expect(screen.queryByTestId("tag-description-/r/a.mp3")).toBeNull();
    const header = screen.getByText("Name").closest("div")!;
    expect(within(header).queryByText("Description")).toBeNull();
  });
});
