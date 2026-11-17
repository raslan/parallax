// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Candidate, MatchRowState } from "@/types/subtitle";
import { MatchesView } from "./MatchesView";

afterEach(cleanup);

const cand = (id: string): Candidate => ({
  subtitle_id: id,
  provider: "subf2m",
  language: "en",
  release: `Show.S01E0${id}.1080p.WEB`,
  score: 1,
  hearing_impaired: false,
});

const row = (n: number, extra: Partial<MatchRowState> = {}): MatchRowState => ({
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

function renderMatches(
  rows: MatchRowState[],
  overrides: Partial<Parameters<typeof MatchesView>[0]> = {},
) {
  const props = {
    titles: [{ key: "tv:show", name: "Show (2016)" }],
    rows,
    wanted: ["en"],
    progress: { done: rows.length, total: rows.length },
    checks: { done: 0, total: 0 },
    running: false,
    jobStatus: "completed",
    jobError: null,
    cancelling: false,
    onCancel: vi.fn(),
    checksSkipped: false,
    errors: [],
    onToggleUse: vi.fn(),
    onApproveAllClean: vi.fn(),
    onFindAnother: vi.fn(),
    onCompare: vi.fn(),
    settingsEngine: "alass",
    downloading: false,
    onDownload: vi.fn(),
    ...overrides,
  };
  render(<MatchesView {...props} />);
  return props;
}

const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLElement;
const checked = (name: string) => box(name).getAttribute("aria-checked") === "true";

describe("MatchesView", () => {
  it("counts only clean rows for Approve all, leaving flagged ones", () => {
    const p = renderMatches([
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
    const p = renderMatches([row(1), row(2, { title: "tv:other", key: "9|en" })], {
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
    renderMatches(
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

  it("tags a season pack candidate, and only that", () => {
    const pack = { ...cand("1"), release_kind: "season_pack" as const };
    const episode = { ...cand("2"), release_kind: "episode" as const };
    renderMatches([
      row(1, { candidate: pack, candidates: [pack] }),
      row(2, { candidate: episode, candidates: [episode] }),
      row(3),
    ]);
    const tags = screen.getAllByText("season pack");
    expect(tags).toHaveLength(1);
    expect(tags[0]?.getAttribute("title")).toBe("A season pack: only this episode's file is used");
  });

  it("shows no identity note once every title is confirmed", () => {
    renderMatches([row(1)], { unconfirmed: new Set() });
    expect(screen.queryByText(/Identity not confirmed/)).toBeNull();
  });

  it("does not count a row still waiting for its length check as clean", () => {
    renderMatches([row(1), row(2, { lengthResult: undefined })]);
    expect(screen.getByRole("button", { name: /Approve all clean rows \(1\)/ })).toBeTruthy();
  });

  it("counts an unchecked row once checks were skipped", () => {
    renderMatches([row(1, { lengthResult: undefined })], { checksSkipped: true });
    expect(screen.getByRole("button", { name: /Approve all clean rows \(1\)/ })).toBeTruthy();
  });

  it("says a download replaces the existing subtitle only while Keep existing is off", () => {
    renderMatches([row(1, { hasReal: true })]);
    expect(screen.getByText("Replaces the existing subtitle")).toBeTruthy();
    fireEvent.click(box("Keep existing subtitles"));
    expect(screen.queryByText("Replaces the existing subtitle")).toBeNull();
  });

  it("keeps a source that does not apply out of the red failure banner", () => {
    renderMatches([row(1, { status: "none", candidate: undefined, candidates: [] })], {
      errors: [],
      notes: [{ provider: "yts", message: "Films only", count: 1 }],
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Films only/)).toBeTruthy();
  });

  it("says a download replaces the generated file only while Keep existing is off", () => {
    renderMatches([row(1, { status: "replaces_machine", machineKind: "generated" })]);
    expect(screen.getByText("Replaces the generated English file")).toBeTruthy();
    fireEvent.click(box("Keep existing subtitles"));
    expect(screen.queryByText("Replaces the generated English file")).toBeNull();
  });

  it("starts both tickboxes off on every mount", () => {
    renderMatches([row(1)]);
    fireEvent.click(box("Keep existing subtitles"));
    fireEvent.click(box("Sync after download"));
    expect(checked("Keep existing subtitles")).toBe(true);
    cleanup();
    renderMatches([row(1)]);
    expect(checked("Keep existing subtitles")).toBe(false);
    expect(checked("Sync after download")).toBe(false);
  });

  it("downloads the approved rows with the run options", () => {
    const p = renderMatches([
      row(1, { verdict: "use" }),
      row(2),
      row(3, { verdict: "use_and_sync" }),
    ]);
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
          season: 1,
          episode: 1,
        },
        {
          video_path: "/tv/Show/S01E03.mkv",
          language: "en",
          provider: "subf2m",
          subtitle_id: "3",
          sync: true,
          season: 1,
          episode: 3,
        },
      ],
    });
  });

  it("offers Find another on a row with a real subtitle, and Compare on a candidate", () => {
    const p = renderMatches([
      row(1, { status: "has_real", candidate: undefined, candidates: [] }),
      row(2),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Find another/ }));
    expect(p.onFindAnother).toHaveBeenCalledWith("1|en");
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    expect(p.onCompare).toHaveBeenCalledWith(expect.objectContaining({ key: "2|en" }));
  });

  it("shows the search progress and Cancel while it runs, and that it runs on the server", () => {
    const p = renderMatches([row(1), row(2)], {
      running: true,
      jobStatus: "running",
      progress: { done: 1, total: 3 },
    });
    expect(screen.getByText("Searching the sources")).toBeTruthy();
    expect(screen.getByText(/1 of 3/)).toBeTruthy();
    expect(
      screen.getByText("Searching and checking runs on the server. You can leave this page."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel search" }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows the length-check progress once the searches are done", () => {
    renderMatches([row(1)], {
      running: true,
      jobStatus: "running",
      progress: { done: 3, total: 3 },
      checks: { done: 3, total: 10 },
    });
    expect(screen.getByText("Checking subtitle lengths")).toBeTruthy();
    expect(screen.getByText(/3 of 10/)).toBeTruthy();
  });

  it("has no Pause, Resume, Skip checks or Retry: only Cancel controls a running search", () => {
    renderMatches(
      [
        row(1, {
          status: "none",
          candidate: undefined,
          candidates: [],
          errors: [{ provider: "subf2m", message: "down" }],
        }),
      ],
      {
        running: true,
        jobStatus: "running",
        progress: { done: 0, total: 1 },
        errors: [{ provider: "subf2m", message: "down", count: 1 }],
      },
    );
    for (const name of ["Pause", "Resume", "Skip checks", "Retry"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "Cancel search" })).toBeTruthy();
  });

  it("shows no progress and no Cancel once the search has ended", () => {
    renderMatches([row(1)], {
      progress: { done: 1, total: 3 }, // an ended search that never got to two rows
      checks: { done: 0, total: 5 },
    });
    expect(screen.queryByText("Searching the sources")).toBeNull();
    expect(screen.queryByText("Checking subtitle lengths")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel search" })).toBeNull();
  });

  it("disables Cancel while the cancel is being sent", () => {
    renderMatches([row(1)], {
      running: true,
      jobStatus: "running",
      progress: { done: 0, total: 1 },
      cancelling: true,
    });
    expect(
      (screen.getByRole("button", { name: "Cancel search" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("says a cancelled search was cancelled, and keeps what it found on screen", () => {
    renderMatches([row(1)], { jobStatus: "cancelled" });
    expect(screen.getByRole("status").textContent).toMatch(/This search was cancelled/);
    expect(screen.getByRole("checkbox", { name: /Download/ })).toBeTruthy();
  });

  it("shows why a failed search failed", () => {
    renderMatches([row(1, { status: "failed", candidate: undefined, candidates: [] })], {
      jobStatus: "failed",
      jobError: "The source is down",
    });
    expect(screen.getByRole("alert").textContent).toMatch(/The search failed: The source is down/);
  });

  it("shows a failed row's error with Find another", () => {
    const p = renderMatches([
      row(1, {
        status: "failed",
        candidate: undefined,
        candidates: [],
        errors: [{ provider: "search", message: "The source took too long to answer" }],
      }),
    ]);
    expect(screen.getByText(/The source took too long to answer/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Find another/ }));
    expect(p.onFindAnother).toHaveBeenCalledWith("1|en");
  });

  it("counts a failed row apart from one that found nothing", () => {
    renderMatches(
      [
        row(1),
        row(2, { status: "failed", candidate: undefined, candidates: [] }),
        row(3, { status: "none", candidate: undefined, candidates: [] }),
      ],
      {},
    );
    expect(screen.getAllByText(/1 failed/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 nothing found/).length).toBeGreaterThan(0);
  });
});

describe("MatchesView after an automatic save", () => {
  const savedRow = (n: number) => row(n, { outcome: "saved" });
  const leftRow = (n: number, reason: NonNullable<MatchRowState["reason"]>) =>
    row(n, { outcome: "left", reason });

  it("marks each row with what automatic save did", () => {
    renderMatches([
      savedRow(1),
      leftRow(2, "only_season_pack"),
      row(3, { outcome: "failed", detail: "Could not save: Permission denied" }),
    ]);
    expect(screen.getAllByText("Saved")).toHaveLength(1);
    expect(screen.getAllByText("Left for you: Only a season pack was found")).toHaveLength(1);
    expect(screen.getAllByText("Save failed: Could not save: Permission denied")).toHaveLength(1);
  });

  it("does not offer to download a row that was already saved", () => {
    renderMatches([savedRow(1), leftRow(2, "length_short")]);
    expect(screen.queryByRole("checkbox", { name: /Download S01E01 English/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Download S01E02 English/ })).toBeTruthy();
  });

  it("summarises what was left, per reason, with a Review button", () => {
    renderMatches([
      savedRow(1),
      leftRow(2, "only_season_pack"),
      leftRow(3, "length_short"),
      row(4, { outcome: "left", reason: "length_short" }),
    ]);
    const summary = screen.getByRole("region", { name: "Left for you" });
    expect(summary.textContent).toMatch(/Left for you · 3/);
    expect(summary.textContent).toMatch(/1 Only a season pack was found/);
    expect(summary.textContent).toMatch(/2 Looks too short for the video/);
    expect(summary.querySelector("button")?.textContent).toBe("Review");
  });

  it("has no summary when nothing was left", () => {
    renderMatches([savedRow(1), row(2)]);
    expect(screen.queryByRole("region", { name: "Left for you" })).toBeNull();
  });

  it("has no summary for a search that saved nothing automatically", () => {
    renderMatches([row(1), row(2)]);
    expect(screen.queryByText(/Left for you/)).toBeNull();
  });

  it("Review shows only the left rows, and Show all rows brings the others back", () => {
    renderMatches([savedRow(1), leftRow(2, "length_long"), row(3)]);
    expect(screen.getByText("S01E01")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.queryByText("S01E01")).toBeNull();
    expect(screen.queryByText("S01E03")).toBeNull();
    expect(screen.getByText("S01E02")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all rows" }));
    expect(screen.getByText("S01E01")).toBeTruthy();
    expect(screen.getByText("S01E03")).toBeTruthy();
  });

  it("includes a row whose save failed in Review, and says how many failed", () => {
    renderMatches([
      leftRow(1, "length_short"),
      row(2, { outcome: "failed", detail: "Could not save: disk full" }),
      savedRow(3),
    ]);
    const summary = screen.getByRole("region", { name: "Left for you" });
    expect(summary.textContent).toMatch(/1 failed to save/);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("S01E01")).toBeTruthy();
    expect(screen.getByText("S01E02")).toBeTruthy();
    expect(screen.queryByText("S01E03")).toBeNull();
  });

  it("approving rows after Review goes through the normal download", () => {
    // The page keeps the ticks: here the user has already ticked the left row.
    const p = renderMatches([savedRow(1), { ...leftRow(2, "length_short"), verdict: "use" }]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("checkbox", { name: /Download S01E02 English/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download 1 subtitle" }));
    expect(p.onDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ video_path: "/tv/Show/S01E02.mkv", subtitle_id: "2" })],
      }),
    );
  });
});
