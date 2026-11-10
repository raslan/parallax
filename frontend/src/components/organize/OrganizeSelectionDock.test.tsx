// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { OrganizeSelectionDock } from "./OrganizeSelectionDock";

afterEach(cleanup);

const base = {
  count: 2,
  bytes: 2048,
  deleting: false,
  progress: null,
  onClear: vi.fn(),
  onMoveToFolder: vi.fn(),
  onMoveToSubfolder: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
};

describe("OrganizeSelectionDock", () => {
  it("shows the four actions and calls them", () => {
    const onDelete = vi.fn();
    const onRename = vi.fn();
    render(<OrganizeSelectionDock {...base} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: /Rename/ }));
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Move to folder/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Move to subfolder/ })).toBeTruthy();
  });

  it("shows how far a big delete has got once it goes past one 500-file chunk", () => {
    render(<OrganizeSelectionDock {...base} deleting progress={{ sent: 600, total: 1200 }} />);
    expect(screen.getByText(/Deleting/).textContent).toBe("Deleting 600 / 1,200…");
  });

  it("shows a plain 'Deleting…' for a single chunk and disables every action", () => {
    render(<OrganizeSelectionDock {...base} deleting progress={{ sent: 0, total: 400 }} />);
    expect(screen.getByText("Deleting…")).toBeTruthy();
    for (const name of [/Move to folder/, /Move to subfolder/, /Rename/]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
