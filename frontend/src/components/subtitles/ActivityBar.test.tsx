// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ActiveJob } from "@/types/subtitle";
import { ActivityBar } from "./ActivityBar";

afterEach(cleanup);

const running: ActiveJob = {
  id: 7,
  type: "subtitle_download",
  status: "running",
  progress: 40,
  current_file: "/tv/Show/e05.mkv",
  queue_position: null,
};
const queued: ActiveJob = {
  id: 8,
  type: "subtitle_sync",
  status: "pending",
  progress: 0,
  current_file: null,
  queue_position: 2,
};

function renderBar(jobs: ActiveJob[], onCancel = vi.fn()) {
  render(
    <MemoryRouter>
      <ActivityBar jobs={jobs} cancelling={new Set()} onCancel={onCancel} />
    </MemoryRouter>,
  );
  return onCancel;
}

describe("ActivityBar", () => {
  it("shows the queue position of a waiting job with a link to Jobs", () => {
    renderBar([running, queued]);
    expect(screen.getByText(/Waiting for another job, position 2/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Jobs/ }).getAttribute("href")).toBe("/jobs");
  });

  it("shows progress and the current file of a running job, and cancels it", () => {
    const onCancel = renderBar([running]);
    expect(screen.getByText("e05.mkv")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Cancel Subtitle download/ }));
    expect(onCancel).toHaveBeenCalledWith(7);
  });

  it("renders nothing when no work runs on the folder", () => {
    const { container } = render(
      <MemoryRouter>
        <ActivityBar jobs={[]} cancelling={new Set()} onCancel={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("ActivityBar for a subtitle search", () => {
  const search: ActiveJob = {
    id: 12,
    type: "subtitle_search",
    status: "running",
    progress: 30,
    current_file: "Searching e05.mkv",
    queue_position: null,
  };

  it("shows Show the matches beside Cancel, and opens that search", () => {
    const onOpenMatches = vi.fn();
    render(
      <MemoryRouter>
        <ActivityBar
          jobs={[search]}
          cancelling={new Set()}
          onCancel={vi.fn()}
          onOpenMatches={onOpenMatches}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Subtitle search")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the matches" }));
    expect(onOpenMatches).toHaveBeenCalledWith(12);
    expect(screen.getByRole("button", { name: /Cancel Subtitle search/ })).toBeTruthy();
  });

  it("shows it for a waiting search too, and never on a download or sync", () => {
    render(
      <MemoryRouter>
        <ActivityBar
          jobs={[{ ...search, status: "pending", queue_position: 1 }, running, queued]}
          cancelling={new Set()}
          onCancel={vi.fn()}
          onOpenMatches={vi.fn()}
          onOpenRun={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("button", { name: "Show the matches" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Show the run" })).toHaveLength(1);
  });
});
