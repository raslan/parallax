// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TagPanel } from "./TagPanel";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

afterEach(cleanup);

const file = (name: string): OrganizeFile => ({
  name,
  path: `/r/${name}`,
  kind: "video",
  size: 1000,
  mtime: 0,
});

const info = (fields: Record<string, string>, raw = fields): OrganizeTagInfo => ({
  fields,
  raw,
  streams: ["video hevc 1080×1920", "audio aac 2ch 48000 Hz"],
  truncated: false,
});

const DESC = "#t ".repeat(41) + "x".repeat(1077); // 1,200 characters, 41 hashtags

const base = {
  open: true,
  onOpenChange: vi.fn(),
  loading: false,
  redact: false,
};

describe("TagPanel, one file", () => {
  const f = file("karina.mkv");
  const one = {
    ...base,
    files: [f],
    infos: {
      [f.path]: info(
        { title: "Fancam", description: DESC },
        { title: "Fancam", DESCRIPTION: DESC, PURL: "https://y/z" },
      ),
    },
  };

  it("shows the name, title, raw tags and streams", () => {
    render(<TagPanel {...one} />);
    expect(screen.getByText("karina.mkv")).toBeTruthy();
    // Once as the title, once in the list of every tag as stored.
    expect(screen.getAllByText("Fancam")).toHaveLength(2);
    expect(screen.getByText("PURL")).toBeTruthy();
    expect(screen.getByText("https://y/z")).toBeTruthy();
    expect(screen.getByText("video hevc 1080×1920")).toBeTruthy();
  });

  it("states how long a description is and expands it on request", () => {
    render(<TagPanel {...one} />);
    expect(screen.getByText("1,200 characters · 41 hashtags")).toBeTruthy();
    const text = screen.getByTestId("tag-panel-description");
    expect(text.className).toContain("line-clamp");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(text.className).not.toContain("line-clamp");
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("lists two identical streams without a duplicate-key warning", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const twin = { ...info({ title: "T" }), streams: ["audio aac 2ch", "audio aac 2ch"] };
    render(<TagPanel {...base} files={[f]} infos={{ [f.path]: twin }} />);
    expect(screen.getAllByText("audio aac 2ch")).toHaveLength(2);
    expect(err.mock.calls.flat().join(" ")).not.toContain("same key");
    err.mockRestore();
  });

  it("shows a dash for a file with no tags", () => {
    render(<TagPanel {...base} files={[f]} infos={{ [f.path]: null }} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("puts no tag text in the page when redacting", () => {
    render(<TagPanel {...one} redact />);
    expect(screen.getByText("Redacted file")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("Fancam");
    expect(document.body.innerHTML).not.toContain("https://y/z");
    expect(document.body.innerHTML).not.toContain("#t #t");
    expect(document.body.innerHTML).not.toContain("karina.mkv");
  });

  it("is closed by Escape but not by interacting outside it", () => {
    const onOpenChange = vi.fn();
    render(<TagPanel {...one} onOpenChange={onOpenChange} />);
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("TagPanel, several files", () => {
  const files = [file("a.mkv"), file("b.mkv"), file("c.mkv")];
  const many = {
    ...base,
    files,
    infos: {
      "/r/a.mkv": info({ title: "A", genre: "Fancam" }),
      "/r/b.mkv": info({ title: "B", genre: "Fancam" }),
      "/r/c.mkv": info({ genre: "Fancam" }),
    },
  };

  it("shows Mixed where values differ, the value where they agree, and no raw list", () => {
    render(<TagPanel {...many} />);
    expect(screen.getByText("3 files")).toBeTruthy();
    expect(screen.getByText("Mixed (2 values, 1 empty)")).toBeTruthy();
    expect(screen.getByText("Fancam")).toBeTruthy();
    expect(screen.queryByText("All tags")).toBeNull();
  });

  it("hides the values but keeps Mixed when redacting", () => {
    render(<TagPanel {...many} redact />);
    expect(screen.getByText("Mixed (2 values, 1 empty)")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("Fancam");
  });

  it("does not call two long values the same when only their first 500 characters were compared", () => {
    const long = "x".repeat(500) + "…";
    const capped = { ...info({ description: long }), truncated: true };
    render(
      <TagPanel
        {...base}
        files={[file("a.mkv"), file("b.mkv")]}
        infos={{ "/r/a.mkv": capped, "/r/b.mkv": capped }}
      />,
    );
    expect(screen.getByText(/only the first 500 characters/i)).toBeTruthy();
  });

  it("says it is loading while some files' tags have not arrived", () => {
    render(<TagPanel {...many} infos={{ "/r/a.mkv": info({ title: "A" }) }} loading />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
  });
});
