// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TitleGroup } from "@/types/subtitle";
import { TitleCard } from "./TitleCard";

afterEach(cleanup);

const group = (extra: Partial<TitleGroup> = {}): TitleGroup => ({
  key: "tv:stranger things:2016",
  title: "Stranger Things",
  year: 2016,
  type: "tv",
  files: [],
  layout_clean: false,
  needs_choice: false,
  ...extra,
});

const props = {
  files: 34,
  seasons: 4,
  wanted: ["en", "ar"],
  coverage: {
    en: { real: 28, generated: 1, translated: 0, total: 34 },
    ar: { real: 0, generated: 0, translated: 0, total: 34 },
  },
  selected: false,
  onToggleSelect: vi.fn(),
  onOpen: vi.fn(),
};

describe("TitleCard", () => {
  it("says the layout looks right for a clean layout", () => {
    render(<TitleCard {...props} group={group({ layout_clean: true })} />);
    expect(screen.getByText("Layout looks right")).toBeTruthy();
    expect(screen.getByText("Stranger Things")).toBeTruthy();
    expect(screen.getByText("34 files · 4 seasons")).toBeTruthy();
  });

  it("asks to pick which one when the title is ambiguous", () => {
    render(<TitleCard {...props} group={group({ needs_choice: true, year: null })} />);
    expect(screen.getByText("Pick which one")).toBeTruthy();
    expect(screen.queryByText("Layout looks right")).toBeNull();
  });

  it("shows each wanted language's real count and opens or selects on click", () => {
    const onOpen = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <TitleCard {...props} group={group()} onOpen={onOpen} onToggleSelect={onToggleSelect} />,
    );
    expect(screen.getByLabelText("English: 28 of 34 with a real subtitle")).toBeTruthy();
    expect(screen.getByLabelText("Arabic: 0 of 34 with a real subtitle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open Stranger Things/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Stranger Things" }));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
  });
});
