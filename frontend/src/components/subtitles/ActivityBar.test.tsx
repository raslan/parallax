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
