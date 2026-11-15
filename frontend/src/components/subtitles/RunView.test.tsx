// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { RunEntry } from "@/types/subtitle";
import { RunView } from "./RunView";

afterEach(cleanup);

const entry = (n: number, state: RunEntry["state"], error?: string): RunEntry => ({
  item: {
    video_path: `/tv/Show/S01E0${n}.mkv`,
    language: "en",
    provider: "subf2m",
    subtitle_id: String(n),
    sync: false,
  },
  state,
  result:
    state === "waiting"
      ? null
      : { video_path: `/tv/Show/S01E0${n}.mkv`, language: "en", status: state, error },
});

function renderRun(entries: RunEntry[], status = "completed", retrying = false) {
  const props = {
    retrying,
    entries,
    titleOf: () => ({ key: "tv:show", name: "Show (2016)" }),
    status,
    currentFile: null,
    queuePosition: null,
    error: null,
    cancelling: false,
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onCompare: vi.fn(),
  };
  render(
    <MemoryRouter>
      <RunView {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe("RunView", () => {
  it("counts each title's results and offers Retry and Pick another per failure", () => {
    const p = renderRun([entry(1, "saved"), entry(2, "failed", "Download failed: 404")]);
    expect(screen.getByText(/1 saved/)).toBeTruthy();
    expect(screen.getByText(/1 failed/)).toBeTruthy();
    expect(screen.getByText("Download failed: 404")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(p.onRetry).toHaveBeenCalledWith(p.entries[1]?.item);
    fireEvent.click(screen.getByRole("button", { name: /Pick another/ }));
    expect(p.onCompare).toHaveBeenCalledWith(p.entries[1]?.item);
  });

  it("disables Retry while a retry is being submitted", () => {
    renderRun([entry(1, "failed", "x")], "completed", true);
    expect((screen.getByRole("button", { name: /Retry/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("can cancel while the run is going", () => {
    const p = renderRun([entry(1, "saved"), entry(2, "waiting")], "running");
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(p.onCancel).toHaveBeenCalled();
  });
});
