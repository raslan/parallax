// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Radix Popover positions itself with ResizeObserver, absent from jsdom.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

import { TagColumnsMenu } from "./TagColumnsMenu";

afterEach(cleanup);

describe("TagColumnsMenu", () => {
  it("lists every tag and ticks the chosen ones", () => {
    render(<TagColumnsMenu selected={["title"]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
    expect(screen.getByRole("checkbox", { name: "Title" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "Genre" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("adds a column in the menu's own order, whichever was ticked first", () => {
    const onChange = vi.fn();
    render(<TagColumnsMenu selected={["genre"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Title" }));
    expect(onChange).toHaveBeenCalledWith(["title", "genre"]);
  });

  it("removes a column", () => {
    const onChange = vi.fn();
    render(<TagColumnsMenu selected={["title", "genre"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Title" }));
    expect(onChange).toHaveBeenCalledWith(["genre"]);
  });
});
