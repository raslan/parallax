// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Candidate, PlanRowState } from "@/types/subtitle";
import { PlanView } from "./PlanView";

afterEach(cleanup);

const cand = (id: string): Candidate => ({
  subtitle_id: id,
  provider: "subf2m",
  language: "en",
  release: `Show.S01E0${id}.1080p.WEB`,
  score: 1,
  hearing_impaired: false,
});

const row = (n: number, extra: Partial<PlanRowState> = {}): PlanRowState => ({
  key: `${n}|en`,
  video: `/tv/Show/S01E0${n}.mkv`,
  filename: `S01E0${n}.mkv`,
  title: "tv:show",
  season: 1,
  episode: n,
  language: "en",
  status: "ready",
  candidate: cand(String(n)),
  candidates: [cand(String(n))],
  machineKind: null,
  hasReal: false,
  errors: [],
  lengthResult: { length: "ok", last: 2900, videoDuration: 3000 },
  ...extra,
});

function renderPlan(rows: PlanRowState[], overrides: Partial<Parameters<typeof PlanView>[0]> = {}) {
  const props = {
    titles: [{ key: "tv:show", name: "Show (2016)" }],
    rows,
    wanted: ["en"],
    progress: { done: rows.length, total: rows.length },
    checks: { done: 0, total: 0 },
    paused: false,
    checksSkipped: false,
    errors: [],
    onPause: vi.fn(),
    onResume: vi.fn(),
    onSkipChecks: vi.fn(),
    onRetrySearch: vi.fn(),
    onToggleUse: vi.fn(),
    onApproveAllClean: vi.fn(),
    onFindAnother: vi.fn(),
    onCompare: vi.fn(),
    settingsEngine: "alass",
    downloading: false,
    onDownload: vi.fn(),
    ...overrides,
  };
  render(<PlanView {...props} />);
  return props;
}

const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLElement;
const checked = (name: string) => box(name).getAttribute("aria-checked") === "true";

describe("PlanView", () => {
  it("counts only clean rows for Approve all, leaving flagged ones", () => {
    const p = renderPlan([
      row(1),
      row(2, { status: "replaces_machine", machineKind: "generated" }),
      row(3, {
        status: "flagged",
        lengthResult: { length: "short", last: 600, videoDuration: 3000 },
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Approve all clean rows \(2\)/ }));
    expect(p.onApproveAllClean).toHaveBeenCalledTimes(1);
  });

  it("keeps rows of an unconfirmed title out of Approve all and says why", () => {
    const onPickTitle = vi.fn();
    const p = renderPlan([row(1), row(2, { title: "tv:other", key: "9|en" })], {
      titles: [
        { key: "tv:show", name: "Show" },
        { key: "tv:other", name: "Other" },
      ],
      unconfirmed: new Set(["tv:other"]),
      onPickTitle,
    });
    // Only the confirmed title's row counts.
    fireEvent.click(screen.getByRole("button", { name: /Approve all clean rows \(1\)/ }));
    expect(p.onApproveAllClean).toHaveBeenCalledWith(new Set(["tv:other"]));
    // The rail marks the title; opening it shows the note with a way back to Titles.
    expect(screen.getByText("identity not confirmed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Other/ }));
    expect(screen.getByText(/Identity not confirmed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Pick which one/ }));
    expect(onPickTitle).toHaveBeenCalledTimes(1);
  });

  it("says nothing found, not all clean, for a title with a row that found nothing", () => {
    renderPlan(
      [
        row(1),
        row(2, { title: "tv:other", key: "9|en", status: "none", candidate: undefined }),
        row(3, { title: "tv:third", key: "8|en" }),
      ],
      {
        titles: [
          { key: "tv:show", name: "Show" },
          { key: "tv:other", name: "Other" },
          { key: "tv:third", name: "Third" },
        ],
      },
    );
    expect(screen.getByText("nothing found for 1")).toBeTruthy();
    expect(screen.getAllByText("all clean")).toHaveLength(2);
  });

  it("shows no identity note once every title is confirmed", () => {
    renderPlan([row(1)], { unconfirmed: new Set() });
    expect(screen.queryByText(/Identity not confirmed/)).toBeNull();
  });

  it("does not count a row still waiting for its length check as clean", () => {
    renderPlan([row(1), row(2, { lengthResult: undefined })]);
    expect(screen.getByRole("button", { name: /Approve all clean rows \(1\)/ })).toBeTruthy();
  });

  it("counts an unchecked row once checks were skipped", () => {
    renderPlan([row(1, { lengthResult: undefined })], { checksSkipped: true });
    expect(screen.getByRole("button", { name: /Approve all clean rows \(1\)/ })).toBeTruthy();
  });

  it("says a download replaces the existing subtitle only while Keep existing is off", () => {
    renderPlan([row(1, { hasReal: true })]);
    expect(screen.getByText("Replaces the existing subtitle")).toBeTruthy();
    fireEvent.click(box("Keep existing subtitles"));
    expect(screen.queryByText("Replaces the existing subtitle")).toBeNull();
  });

  it("keeps a source that does not apply out of the red failure banner", () => {
    renderPlan([row(1, { status: "none", candidate: undefined, candidates: [] })], {
      errors: [],
      notes: [{ provider: "yts", message: "Films only", count: 1 }],
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Films only/)).toBeTruthy();
  });

  it("says a download replaces the generated file only while Keep existing is off", () => {
    renderPlan([row(1, { status: "replaces_machine", machineKind: "generated" })]);
    expect(screen.getByText("Replaces the generated English file")).toBeTruthy();
    fireEvent.click(box("Keep existing subtitles"));
    expect(screen.queryByText("Replaces the generated English file")).toBeNull();
  });

  it("starts both tickboxes off on every mount", () => {
    renderPlan([row(1)]);
    fireEvent.click(box("Keep existing subtitles"));
    fireEvent.click(box("Sync after download"));
    expect(checked("Keep existing subtitles")).toBe(true);
    cleanup();
    renderPlan([row(1)]);
    expect(checked("Keep existing subtitles")).toBe(false);
    expect(checked("Sync after download")).toBe(false);
  });

  it("downloads the approved rows with the run options", () => {
    const p = renderPlan([row(1, { verdict: "use" }), row(2), row(3, { verdict: "use_and_sync" })]);
    fireEvent.click(box("Keep existing subtitles"));
    fireEvent.click(box("Sync after download"));
    fireEvent.click(screen.getByRole("button", { name: "ffsubsync" }));
    fireEvent.click(screen.getByRole("button", { name: "Download 2 subtitles" }));
    expect(p.onDownload).toHaveBeenCalledWith({
      keep_existing: true,
      sync_after: true,
      engine: "ffsubsync",
      items: [
        {
          video_path: "/tv/Show/S01E01.mkv",
          language: "en",
          provider: "subf2m",
          subtitle_id: "1",
          sync: false,
        },
        {
          video_path: "/tv/Show/S01E03.mkv",
          language: "en",
          provider: "subf2m",
          subtitle_id: "3",
          sync: true,
        },
      ],
    });
  });

  it("offers Find another on a row with a real subtitle, and Compare on a candidate", () => {
    const p = renderPlan([
      row(1, { status: "has_real", candidate: undefined, candidates: [] }),
      row(2),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Find another/ }));
    expect(p.onFindAnother).toHaveBeenCalledWith("1|en");
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(p.onCompare).toHaveBeenCalledWith(expect.objectContaining({ key: "2|en" }));
  });

  it("shows the length-check progress with Pause and Skip checks", () => {
    const p = renderPlan([row(1)], { checks: { done: 3, total: 10 } });
    expect(screen.getByText(/3 of 10/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip checks" }));
    expect(p.onPause).toHaveBeenCalled();
    expect(p.onSkipChecks).toHaveBeenCalled();
  });
});
