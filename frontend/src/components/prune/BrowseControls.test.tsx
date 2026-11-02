// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { BrowseControls } from "@/components/prune/BrowseControls";

afterEach(cleanup);

// Radix Slider (the card-size control) reads ResizeObserver, absent from jsdom.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const base = { viewMode: "grid" as const, onViewMode: vi.fn(), size: 240, onSize: vi.fn() };

describe("BrowseControls", () => {
  it("shows both sort pickers beside the view toggle, and the arrow re-sorts", () => {
    const onFolderSort = vi.fn();
    render(
      <BrowseControls
        {...base}
        folderSort={{
          label: "Sort folders",
          options: [{ value: "files", label: "Files" }],
          value: "files",
          dir: "desc",
          onSort: onFolderSort,
        }}
        fileSort={{
          label: "Sort files",
          options: [{ value: "size", label: "Size" }],
          value: "size",
          dir: "asc",
          onSort: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Sort folders" }).textContent).toContain("Files");
    expect(screen.getByRole("combobox", { name: "Sort files" }).textContent).toContain("Size");
    fireEvent.click(screen.getByRole("button", { name: /Descending/ }));
    expect(onFolderSort).toHaveBeenCalledWith("files");
  });
  it("omits a sort when there is nothing to sort", () => {
    render(<BrowseControls {...base} />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
