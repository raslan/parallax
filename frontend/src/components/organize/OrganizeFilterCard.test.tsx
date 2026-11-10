// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/components/QueryBuilder", () => ({ QueryBuilder: () => <div>query-builder</div> }));
vi.mock("@/components/SmartSelect", () => ({ SmartSelect: () => <div>smart-select</div> }));
vi.mock("@/components/organize/NameGroupChips", () => ({
  NameGroupChips: () => <div>name-chips</div>,
}));

import { OrganizeFilterCard } from "./OrganizeFilterCard";

afterEach(cleanup);

const base = {
  clauses: [],
  fieldsByKey: {},
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onUpdate: vi.fn(),
  stillLoading: 0,
  redact: false,
  fileNames: ["a.txt"],
  onPickName: vi.fn(),
  smartOptions: [],
  visibleCount: 3,
  hasSelection: true,
  onInvert: vi.fn(),
  onClear: vi.fn(),
};

describe("OrganizeFilterCard", () => {
  it("shows the name-group chips normally and hides them when redacting", () => {
    const { rerender } = render(<OrganizeFilterCard {...base} />);
    expect(screen.getByText("name-chips")).toBeTruthy();
    rerender(<OrganizeFilterCard {...base} redact />);
    expect(screen.queryByText("name-chips")).toBeNull();
  });

  it("says how many details are still loading", () => {
    render(<OrganizeFilterCard {...base} stillLoading={1234} />);
    expect(screen.getByRole("status").textContent).toContain("1,234 still loading");
  });

  it("disables Invert with nothing shown and Clear with nothing selected", () => {
    render(<OrganizeFilterCard {...base} visibleCount={0} hasSelection={false} />);
    expect((screen.getByRole("button", { name: "Invert" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("calls onInvert and onClear", () => {
    const onInvert = vi.fn();
    const onClear = vi.fn();
    render(<OrganizeFilterCard {...base} onInvert={onInvert} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "Invert" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onInvert).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
