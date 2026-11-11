// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StagedEditsChip } from "./StagedEditsChip";

afterEach(cleanup);

describe("StagedEditsChip", () => {
  it("renders nothing while no file has a staged edit", () => {
    const { container } = render(<StagedEditsChip count={0} onReview={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("says how many files have staged edits and opens the review", () => {
    const onReview = vi.fn();
    render(<StagedEditsChip count={3} onReview={onReview} />);
    fireEvent.click(screen.getByRole("button", { name: "Review 3 staged" }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("uses the singular for one file", () => {
    render(<StagedEditsChip count={1} onReview={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Review 1 staged" })).toBeTruthy();
  });

  it("is disabled when told to, for example while names are redacted", () => {
    render(<StagedEditsChip count={2} onReview={vi.fn()} disabled />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
