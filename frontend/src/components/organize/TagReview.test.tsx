// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagReview } from "./TagReview";
import { makeEdits } from "./tagEditsTestUtil";
import type { TagEdits } from "@/hooks/useOrganizeTagEdits";

afterEach(cleanup);

type Row = TagEdits["review"]["rows"][number];
const row = (over: Partial<Row> = {}): Row => ({
  path: "/r/a.mp3",
  changes: [{ field: "title", before: "Old title", after: "New title" }],
  blocked: [],
  how: "rewrite",
  reason: null,
  note: null,
  stale: null,
  ...over,
});
const reviewOf = (rows: Row[], over: Partial<TagEdits["review"]> = {}) => ({
  open: true,
  loading: false,
  rows,
  skippedCount: 0,
  neededBytes: 0,
  freeBytes: null,
  ...over,
});

describe("TagReview", () => {
  it("lists before and after per file under its name", () => {
    render(
      <TagReview edits={makeEdits({ stagedCount: 1, review: reviewOf([row()]) })} redact={false} />,
    );
    expect(screen.getByText("a.mp3")).toBeTruthy();
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Old title")).toBeTruthy();
    expect(screen.getByText("New title")).toBeTruthy();
  });

  it("shows a clear as removed and a new tag as added", () => {
    const rows = [
      row({
        changes: [
          { field: "artist", before: "Someone", after: null },
          { field: "raw:MOOD", before: undefined, after: "calm" },
        ],
      }),
    ];
    render(
      <TagReview edits={makeEdits({ stagedCount: 1, review: reviewOf(rows) })} redact={false} />,
    );
    expect(screen.getByText("removed")).toBeTruthy();
    expect(screen.getByText("Someone")).toBeTruthy();
    expect(screen.getByText("MOOD")).toBeTruthy();
    expect(screen.getByText("not set")).toBeTruthy();
    expect(screen.getByText("calm")).toBeTruthy();
  });

  it("makes a long old value reachable in full", () => {
    const long = "word ".repeat(200).trim();
    const rows = [row({ changes: [{ field: "description", before: long, after: "short" }] })];
    render(
      <TagReview edits={makeEdits({ stagedCount: 1, review: reviewOf(rows) })} redact={false} />,
    );
    const before = screen.getByTestId("review-before-description");
    expect(before.className).toContain("line-clamp");
    fireEvent.click(screen.getByRole("button", { name: "Show full" }));
    expect(before.className).not.toContain("line-clamp");
    expect(before.textContent).toBe(long);
  });

  it("says how each file is written and the plan's note", () => {
    const rows = [
      row({ path: "/r/a.mkv", how: "in_place" }),
      row({ path: "/r/b.avi", how: "rewrite", note: "Other tags in this format may not survive." }),
    ];
    render(
      <TagReview edits={makeEdits({ stagedCount: 2, review: reviewOf(rows) })} redact={false} />,
    );
    expect(screen.getByText("In place")).toBeTruthy();
    expect(screen.getByText("Rewrites a copy")).toBeTruthy();
    expect(screen.getByText("Other tags in this format may not survive.")).toBeTruthy();
  });

  it("counts unchanged files as skipped", () => {
    render(
      <TagReview
        edits={makeEdits({ stagedCount: 3, review: reviewOf([row()], { skippedCount: 2 }) })}
        redact={false}
      />,
    );
    expect(screen.getByText(/2 files with nothing to change are skipped/i)).toBeTruthy();
  });

  it("shows the space rewrites need and warns when the folder is too tight", () => {
    const { rerender } = render(
      <TagReview
        edits={makeEdits({
          stagedCount: 1,
          review: reviewOf([row()], { neededBytes: 5_242_880, freeBytes: 900_000_000 }),
        })}
        redact={false}
      />,
    );
    expect(screen.getByText(/biggest rewrite needs about 5\.0 MB/i)).toBeTruthy();
    expect(screen.queryByText(/not enough/i)).toBeNull();
    rerender(
      <TagReview
        edits={makeEdits({
          stagedCount: 1,
          review: reviewOf([row()], { neededBytes: 5_242_880, freeBytes: 1_000_000 }),
        })}
        redact={false}
      />,
    );
    expect(screen.getByText(/not enough free space/i)).toBeTruthy();
  });

  it("flags a stale file and leaves it out of the apply count", () => {
    const rows = [
      row({ path: "/r/a.mp3", stale: "changed" }),
      row({ path: "/r/b.mp3" }),
      row({ path: "/r/c.mp3", stale: "gone" }),
    ];
    render(
      <TagReview edits={makeEdits({ stagedCount: 3, review: reviewOf(rows) })} redact={false} />,
    );
    expect(screen.getByText(/changed since you staged it/i)).toBeTruthy();
    expect(screen.getByText(/no longer be read/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply 1 change" })).toBeTruthy();
  });

  it("shows why a file cannot be written and what its format cannot hold", () => {
    const rows = [
      row({ path: "/r/a.rmvb", how: null, reason: "Parallax can't edit tags in this format." }),
      row({ path: "/r/b.avi", blocked: ["album"] }),
    ];
    render(
      <TagReview edits={makeEdits({ stagedCount: 2, review: reviewOf(rows) })} redact={false} />,
    );
    expect(screen.getByText("Parallax can't edit tags in this format.")).toBeTruthy();
    expect(screen.getByText(/can't hold: Album/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply 1 change" })).toBeTruthy();
  });

  it("Apply counts every change that will be written and is disabled with none", () => {
    const rows = [
      row({
        path: "/r/a.mp3",
        changes: [
          { field: "title", before: "a", after: "b" },
          { field: "artist", before: undefined, after: "x" },
        ],
      }),
      row({ path: "/r/b.mp3" }),
    ];
    const apply = makeEdits().apply;
    const { rerender } = render(
      <TagReview
        edits={makeEdits({ stagedCount: 2, apply, review: reviewOf(rows) })}
        redact={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply 3 changes" }));
    expect(apply).toHaveBeenCalledTimes(1);
    rerender(<TagReview edits={makeEdits({ review: reviewOf([]) })} redact={false} />);
    expect((screen.getByRole("button", { name: /apply/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows progress while applying and disables the buttons", () => {
    render(
      <TagReview
        edits={makeEdits({
          stagedCount: 1,
          applying: true,
          progress: { done: 10, total: 25 },
          review: reviewOf([row()]),
        })}
        redact={false}
      />,
    );
    expect(screen.getByText(/writing 10 \/ 25/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /writing/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: /back/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("lists what went wrong for files that failed", () => {
    render(
      <TagReview
        edits={makeEdits({
          stagedCount: 1,
          review: reviewOf([row()]),
          results: {
            "/r/a.mp3": { status: "failed", message: "Not enough free space in the folder." },
          },
        })}
        redact={false}
      />,
    );
    expect(screen.getByText("Not enough free space in the folder.")).toBeTruthy();
  });

  it("each file has its own Discard, which is how a stale or gone file is started over", () => {
    const rows = [
      row({ path: "/r/a.mp3", stale: "changed" }),
      row({ path: "/r/gone.mp3", stale: "gone" }),
      row({ path: "/r/b.mp3" }),
    ];
    const edits = makeEdits({ stagedCount: 3, review: reviewOf(rows) });
    render(<TagReview edits={edits} redact={false} />);
    const buttons = screen.getAllByRole("button", { name: /Discard edits for this file/ });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[1]!);
    expect(edits.drop).toHaveBeenCalledWith(["/r/gone.mp3"]);
    expect(screen.getAllByText(/discard its edits/i)).toHaveLength(2);
  });

  it("a failure message is announced to assistive tech", () => {
    render(
      <TagReview
        edits={makeEdits({
          stagedCount: 1,
          review: reviewOf([row()]),
          results: { "/r/a.mp3": { status: "failed", message: "Disk is full." } },
        })}
        redact={false}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Disk is full.");
  });

  it("re-reading shows a status and no rows are claimed yet", () => {
    render(
      <TagReview
        edits={makeEdits({ stagedCount: 1, review: reviewOf([], { loading: true }) })}
        redact={false}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/reading/i);
    expect((screen.getByRole("button", { name: /apply/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("Back returns to editing and Discard drops every staged edit", () => {
    const edits = makeEdits({ stagedCount: 1, review: reviewOf([row()]) });
    render(<TagReview edits={edits} redact={false} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(edits.closeReview).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard all edits" }));
    expect(edits.clearAll).toHaveBeenCalled();
  });

  it("names the folder of files that are not in the open one", () => {
    const rows = [row({ path: "/music/live/a.mp3" })];
    render(
      <TagReview edits={makeEdits({ stagedCount: 1, review: reviewOf(rows) })} redact={false} />,
    );
    expect(screen.getByText("live")).toBeTruthy();
  });

  it("puts no file name or tag text in the page when redacting, and cannot apply", () => {
    const rows = [row({ path: "/music/live/secret.mp3" })];
    render(<TagReview edits={makeEdits({ stagedCount: 1, review: reviewOf(rows) })} redact />);
    const html = document.body.innerHTML;
    for (const text of ["secret.mp3", "live", "Old title", "New title"]) {
      expect(html).not.toContain(text);
    }
    expect(screen.getByText("Redacted file")).toBeTruthy();
    expect((screen.getByRole("button", { name: /apply/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
