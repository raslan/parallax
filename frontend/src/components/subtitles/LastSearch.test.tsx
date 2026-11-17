// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Job } from "@/types/job";
import { LastSearch } from "./LastSearch";

afterEach(cleanup);

const job = (extra: Partial<Job> = {}): Job => ({
  id: 14,
  type: "subtitle_search",
  status: "completed",
  library_id: null,
  progress: 100,
  total_files: 48,
  processed_files: 42,
  current_file: "42 of 48 found",
  error: null,
  settings: "{}",
  created_at: "2026-11-17T14:20:00",
  started_at: "2026-11-17T14:20:05",
  finished_at: "2026-11-17T14:32:10",
  ...extra,
});

describe("LastSearch", () => {
  it("says when the search ended and how it went, and opens its matches", () => {
    const onOpen = vi.fn();
    render(<LastSearch job={job()} onOpen={onOpen} />);
    expect(screen.getByText(/Last search/)).toBeTruthy();
    expect(screen.getByText(/42 of 48 found/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the matches" }));
    expect(onOpen).toHaveBeenCalledWith(14);
  });

  it("reads a cancelled search's partial result", () => {
    render(
      <LastSearch
        job={job({ status: "cancelled", current_file: "2 of 3 done before cancel" })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(/Cancelled/)).toBeTruthy();
    expect(screen.getByText(/2 of 3 done before cancel/)).toBeTruthy();
  });

  it("reads a failed search's reason", () => {
    render(
      <LastSearch
        job={job({ status: "failed", current_file: null, error: "The source is down" })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(/Failed/)).toBeTruthy();
    expect(screen.getByText(/The source is down/)).toBeTruthy();
  });

  it("shows nothing while a search is still running or waiting", () => {
    const { container, rerender } = render(
      <LastSearch job={job({ status: "running" })} onOpen={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
    rerender(<LastSearch job={job({ status: "pending" })} onOpen={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("shows nothing for no search", () => {
    const { container } = render(<LastSearch job={null} onOpen={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
