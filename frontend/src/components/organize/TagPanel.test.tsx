// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { TagPanel } from "./TagPanel";
import { aFile, aPlan, makeEdits, someTags } from "./tagEditsTestUtil";
import type { TagEdits } from "@/hooks/useOrganizeTagEdits";
import type { OrganizeTagInfo } from "@/types/organize";

afterEach(cleanup);

const info = (fields: Record<string, string>, raw = fields): OrganizeTagInfo => ({
  ...someTags(fields, raw),
  streams: ["video hevc 1080×1920", "audio aac 2ch 48000 Hz"],
});

const DESC = "#t ".repeat(41) + "x".repeat(1077); // 1,200 characters, 41 hashtags

const panel = (over: Record<string, unknown> = {}) => ({
  open: true,
  onOpenChange: vi.fn(),
  loading: false,
  redact: false,
  edits: makeEdits(),
  files: [aFile("a.mkv")],
  infos: {},
  ...over,
});

describe("TagPanel, one file", () => {
  const f = aFile("karina.mkv");
  const one = (editsOver: Partial<TagEdits> = {}) =>
    panel({
      files: [f],
      infos: {
        [f.path]: info(
          { title: "Fancam", description: DESC },
          { title: "Fancam", DESCRIPTION: DESC, PURL: "https://y/z" },
        ),
      },
      edits: makeEdits({
        plans: { [f.path]: aPlan({ fields: ["title", "description", "artist", "raw:PURL"] }) },
        ...editsOver,
      }),
    });

  it("shows the name, the title and description as fields, other tags and the streams", () => {
    render(<TagPanel {...one()} />);
    expect(screen.getByText("karina.mkv")).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Fancam");
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(DESC);
    expect(screen.getByText("PURL")).toBeTruthy();
    expect((screen.getByLabelText("PURL") as HTMLInputElement).value).toBe("https://y/z");
    expect(screen.getByText("video hevc 1080×1920")).toBeTruthy();
  });

  it("states how long a description is and expands it on request", () => {
    render(<TagPanel {...one()} />);
    expect(screen.getByText("1,200 characters · 41 hashtags")).toBeTruthy();
    const area = screen.getByLabelText("Description") as HTMLTextAreaElement;
    const collapsed = area.rows;
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(area.rows).toBeGreaterThan(collapsed);
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("lists two identical streams without a duplicate-key warning", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const twin = { ...info({ title: "T" }), streams: ["audio aac 2ch", "audio aac 2ch"] };
    render(<TagPanel {...panel({ files: [f], infos: { [f.path]: twin } })} />);
    expect(screen.getAllByText("audio aac 2ch")).toHaveLength(2);
    expect(err.mock.calls.flat().join(" ")).not.toContain("same key");
    err.mockRestore();
  });

  it("shows a dash in the tag list for a file with no tags and still offers the fields", () => {
    render(<TagPanel {...panel({ files: [f], infos: { [f.path]: null } })} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  });

  it("typing a value stages it for the file when the field loses focus", () => {
    const edits = makeEdits({ plans: { [f.path]: aPlan() } });
    render(<TagPanel {...one()} edits={edits} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "New title" } });
    expect(edits.stage).not.toHaveBeenCalled(); // nothing happens while typing
    fireEvent.blur(title);
    expect(edits.stage).toHaveBeenCalledWith("title", { op: "set", value: "New title" });
  });

  it("Enter commits a single-line field", () => {
    const edits = makeEdits({ plans: { [f.path]: aPlan() } });
    render(<TagPanel {...one()} edits={edits} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Entered" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(edits.stage).toHaveBeenCalledWith("title", { op: "set", value: "Entered" });
  });

  it("leaving a field without changing it stages nothing", () => {
    const edits = makeEdits({ plans: { [f.path]: aPlan() } });
    render(<TagPanel {...one()} edits={edits} />);
    const title = screen.getByLabelText("Title");
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: "Fancam" } });
    fireEvent.blur(title);
    expect(edits.stage).not.toHaveBeenCalled();
  });

  it("Clear stages a clear and is absent when the field is empty", () => {
    const edits = makeEdits({ plans: { [f.path]: aPlan() } });
    render(<TagPanel {...one()} edits={edits} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear Title" }));
    expect(edits.stage).toHaveBeenCalledWith("title", { op: "clear" });
    cleanup();
    render(<TagPanel {...panel({ files: [f], infos: { [f.path]: info({}) } })} />);
    expect(screen.queryByRole("button", { name: "Clear Title" })).toBeNull();
  });

  it("an edited field shows the staged value, says so, and Undo unstages just that field", () => {
    const edits = makeEdits({
      stagedCount: 1,
      staged: { [f.path]: { title: "Edited" } },
      plans: { [f.path]: aPlan() },
    });
    render(<TagPanel {...one()} edits={edits} />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Edited");
    expect(screen.getByText("Edited")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo Description" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo Title" }));
    expect(edits.unstage).toHaveBeenCalledWith("title");
  });

  it("a tag whose value has line breaks is edited in a text area that keeps them", () => {
    const lyrics = "first line\nsecond line";
    const edits = makeEdits({
      plans: { [f.path]: aPlan({ fields: ["title", "raw:LYRICS"] }) },
    });
    render(
      <TagPanel
        {...panel({
          files: [f],
          infos: { [f.path]: info({ title: "T" }, { title: "T", LYRICS: lyrics }) },
          edits,
        })}
      />,
    );
    const field = screen.getByLabelText("LYRICS") as HTMLTextAreaElement;
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.value).toBe(lyrics);
    // Focusing and leaving it unchanged stages nothing: the lines are not flattened.
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: lyrics } });
    fireEvent.blur(field);
    expect(edits.stage).not.toHaveBeenCalled();
  });

  it("a staged clear reads as an empty, edited field", () => {
    const edits = makeEdits({
      stagedCount: 1,
      staged: { [f.path]: { title: null } },
      plans: { [f.path]: aPlan() },
    });
    render(<TagPanel {...one()} edits={edits} />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Undo Title" })).toBeTruthy();
  });

  it("disables a field the file's format cannot hold and says why", () => {
    const bad = aPlan({
      writable: false,
      how: null,
      reason: "Parallax can't edit tags in this format.",
      fields: [],
    });
    render(<TagPanel {...one({ plans: { [f.path]: bad } })} />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText("Parallax can't edit tags in this format.").length).toBeGreaterThan(
      0,
    );
  });

  it("offers the review only once something is staged", () => {
    const { rerender } = render(<TagPanel {...one()} />);
    expect(screen.queryByRole("button", { name: /review changes/i })).toBeNull();
    const edits = makeEdits({ stagedCount: 2, plans: { [f.path]: aPlan() } });
    rerender(<TagPanel {...one()} edits={edits} />);
    fireEvent.click(screen.getByRole("button", { name: "Review changes (2 files)" }));
    expect(edits.openReview).toHaveBeenCalled();
  });

  it("never has an Apply button in the editing view: every edit goes through the review", () => {
    const edits = makeEdits({ stagedCount: 1, plans: { [f.path]: aPlan() } });
    render(<TagPanel {...one()} edits={edits} />);
    expect(screen.queryByRole("button", { name: /^apply/i })).toBeNull();
  });

  it("shows how far the full read for an edit has got", () => {
    render(<TagPanel {...one({ reading: { done: 2, total: 10 } })} />);
    expect(screen.getByRole("status").textContent).toContain("2 / 10");
  });

  it("shows the review in place of the fields while the review is open", () => {
    const edits = makeEdits({
      stagedCount: 1,
      plans: { [f.path]: aPlan() },
      review: {
        open: true,
        loading: false,
        rows: [],
        skippedCount: 0,
        neededBytes: 0,
        freeBytes: null,
      },
    });
    render(<TagPanel {...one()} edits={edits} />);
    expect(screen.getByRole("button", { name: /back to editing/i })).toBeTruthy();
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("opens straight on the review with nothing selected when edits are staged", () => {
    const edits = makeEdits({
      stagedCount: 3,
      review: {
        open: true,
        loading: false,
        rows: [],
        skippedCount: 0,
        neededBytes: 0,
        freeBytes: null,
      },
    });
    render(<TagPanel {...panel({ files: [], edits })} />);
    expect(screen.getByText("Review staged edits")).toBeTruthy();
    expect(screen.getByRole("button", { name: /back to editing/i })).toBeTruthy();
  });

  it("puts no tag text in the page when redacting, and cannot be edited", () => {
    const edits = makeEdits({ plans: { [f.path]: aPlan() } });
    render(<TagPanel {...one()} edits={edits} redact />);
    expect(screen.getByText("Redacted file")).toBeTruthy();
    expect(screen.queryByLabelText("Title")).toBeNull();
    for (const text of ["Fancam", "https://y/z", "#t #t", "karina.mkv"]) {
      expect(document.body.innerHTML).not.toContain(text);
    }
    expect(screen.queryByRole("button", { name: /clear title/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add field/i })).toBeNull();
  });

  it("is closed by Escape but not by interacting outside it", () => {
    const onOpenChange = vi.fn();
    render(<TagPanel {...one()} onOpenChange={onOpenChange} />);
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("TagPanel, several files", () => {
  const files = [aFile("a.mkv"), aFile("b.mkv"), aFile("c.mkv")];
  const plans = Object.fromEntries(files.map((f) => [f.path, aPlan()]));
  const many = (editsOver: Partial<TagEdits> = {}) =>
    panel({
      files,
      infos: {
        "/r/a.mkv": info({ title: "A", genre: "Fancam" }),
        "/r/b.mkv": info({ title: "B", genre: "Fancam" }),
        "/r/c.mkv": info({ genre: "Fancam" }),
      },
      edits: makeEdits({ plans, ...editsOver }),
    });

  it("shows Mixed where values differ, the value where they agree, and no tag list", () => {
    render(<TagPanel {...many()} />);
    expect(screen.getByText("3 files")).toBeTruthy();
    expect(screen.getByText("Mixed (2 values, 1 empty)")).toBeTruthy();
    expect((screen.getByLabelText("Genre") as HTMLInputElement).value).toBe("Fancam");
    expect(screen.queryByText("All tags")).toBeNull();
  });

  it("typing in a mixed field replaces the value for every selected file", () => {
    const edits = makeEdits({ plans });
    render(<TagPanel {...many()} edits={edits} />);
    const title = screen.getByLabelText("Title");
    expect((title as HTMLInputElement).value).toBe("");
    fireEvent.change(title, { target: { value: "Same for all" } });
    fireEvent.blur(title);
    expect(edits.stage).toHaveBeenCalledWith("title", { op: "set", value: "Same for all" });
  });

  it("hides the values but keeps Mixed when redacting", () => {
    render(<TagPanel {...many()} redact />);
    expect(screen.getByText("Mixed (2 values, 1 empty)")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("Fancam");
  });

  it("does not call two long values the same when only their first 500 characters were compared", () => {
    const long = "x".repeat(500) + "…";
    const capped = { ...info({ description: long }), truncated: true };
    render(
      <TagPanel
        {...panel({
          files: [aFile("a.mkv"), aFile("b.mkv")],
          infos: { "/r/a.mkv": capped, "/r/b.mkv": capped },
        })}
      />,
    );
    expect(screen.getByText(/only the first 500 characters/i)).toBeTruthy();
  });

  it("says it is loading while some files' tags have not arrived", () => {
    render(<TagPanel {...many()} infos={{ "/r/a.mkv": info({ title: "A" }) }} loading />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
  });

  it("Find and replace previews how many files change and stages the replacement", async () => {
    const edits = makeEdits({ plans });
    render(
      <TagPanel
        {...panel({
          files,
          infos: {
            "/r/a.mkv": info({ title: "Live 2020" }),
            "/r/b.mkv": info({ title: "Live 2021" }),
            "/r/c.mkv": info({ title: "Studio" }),
          },
          edits,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Title text" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Title text" });
    fireEvent.change(within(dialog).getByLabelText("Find"), { target: { value: "Live" } });
    fireEvent.change(within(dialog).getByLabelText("Replace with"), { target: { value: "Show" } });
    expect(within(dialog).getByText("2 of 3 files change")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace" }));
    expect(edits.stage).toHaveBeenCalledWith("title", {
      op: "replace",
      rule: { find: "Live", replace: "Show", regex: false },
    });
  });

  it("Find and replace in regex mode reports a bad expression instead of staging", async () => {
    const edits = makeEdits({ plans });
    render(<TagPanel {...many()} edits={edits} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Genre text" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Genre text" });
    fireEvent.click(within(dialog).getByLabelText("Regular expression"));
    fireEvent.change(within(dialog).getByLabelText("Find"), { target: { value: "(" } });
    expect(within(dialog).getByRole("alert")).toBeTruthy();
    expect(
      (within(dialog).getByRole("button", { name: "Replace" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("Add text puts text at the start or the end of each file's value", async () => {
    const edits = makeEdits({ plans });
    render(<TagPanel {...many()} edits={edits} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Genre text" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Genre text" });
    fireEvent.change(within(dialog).getByLabelText("Text to add"), { target: { value: "#live " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "At the start" }));
    expect(edits.stage).toHaveBeenCalledWith("genre", { op: "prepend", text: "#live " });
    fireEvent.click(screen.getByRole("button", { name: "Edit Genre text" }));
    const again = await screen.findByRole("dialog", { name: "Edit Genre text" });
    fireEvent.change(within(again).getByLabelText("Text to add"), { target: { value: " #end" } });
    fireEvent.click(within(again).getByRole("button", { name: "At the end" }));
    expect(edits.stage).toHaveBeenCalledWith("genre", { op: "append", text: " #end" });
  });

  it("Add field offers the fields the files can take that are not shown yet", async () => {
    render(<TagPanel {...many()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add field…" }));
    const menu = await screen.findByRole("dialog", { name: "Add field" });
    for (const name of ["Artist", "Album", "Synopsis", "Comment", "Date"]) {
      expect(within(menu).getByRole("button", { name })).toBeTruthy();
    }
    expect(within(menu).queryByRole("button", { name: "Title" })).toBeNull(); // already shown
    expect(within(menu).queryByRole("button", { name: "Genre" })).toBeNull();
    expect(within(menu).getByRole("button", { name: "Other tag…" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("button", { name: "Artist" }));
    await waitFor(() => expect(screen.getByLabelText("Artist")).toBeTruthy());
  });

  it("Other tag… refuses a standard field's name and stages a new tag by its own name", async () => {
    const edits = makeEdits({ plans });
    render(<TagPanel {...many()} edits={edits} />);
    fireEvent.click(screen.getByRole("button", { name: "Add field…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Other tag…" }));
    const name = await screen.findByLabelText("Tag name");
    fireEvent.change(name, { target: { value: "TITLE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    expect(screen.getByRole("alert").textContent).toContain("Use the Title field");
    fireEvent.change(name, { target: { value: "MOOD" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const field = await screen.findByLabelText("MOOD");
    fireEvent.change(field, { target: { value: "calm" } });
    fireEvent.blur(field);
    expect(edits.stage).toHaveBeenCalledWith("raw:MOOD", { op: "set", value: "calm" });
  });

  it("does not offer Other tag… when no selected file can take a custom name", async () => {
    const closed = Object.fromEntries(files.map((f) => [f.path, aPlan({ can_add_raw: false })]));
    render(<TagPanel {...many({ plans: closed })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add field…" }));
    const menu = await screen.findByRole("dialog", { name: "Add field" });
    expect(within(menu).queryByRole("button", { name: "Other tag…" })).toBeNull();
  });

  it("shows a location row with a Clear button only when a file has a location", () => {
    const withGps = { ...info({ title: "A" }), raw: { "GPS:GPSLatitude": "1" } };
    const edits = makeEdits({ plans: { "/r/a.jpg": aPlan({ fields: ["title", "gps"] }) } });
    render(
      <TagPanel {...panel({ files: [aFile("a.jpg")], infos: { "/r/a.jpg": withGps }, edits })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear Location" }));
    expect(edits.stage).toHaveBeenCalledWith("gps", { op: "clear" });
    cleanup();
    render(<TagPanel {...panel({ files: [aFile("a.jpg")], infos: { "/r/a.jpg": info({}) } })} />);
    expect(screen.queryByText("Location")).toBeNull();
  });
});
