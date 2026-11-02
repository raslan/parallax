// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SortSelect } from "./SortSelect";

afterEach(cleanup);

const OPTIONS = [
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
] as const;

describe("SortSelect", () => {
  it("shows the current key and an arrow for the direction", () => {
    render(
      <SortSelect label="Sort files" options={OPTIONS} value="size" dir="desc" onSort={() => {}} />,
    );
    expect(screen.getByRole("combobox", { name: "Sort files" }).textContent).toContain("Size");
    expect(screen.getByRole("button", { name: "Descending, click to reverse" })).toBeTruthy();
  });

  it("reverses by re-sorting on the current key", () => {
    const onSort = vi.fn();
    render(
      <SortSelect label="Sort files" options={OPTIONS} value="name" dir="asc" onSort={onSort} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ascending, click to reverse" }));
    expect(onSort).toHaveBeenCalledWith("name");
  });
});
