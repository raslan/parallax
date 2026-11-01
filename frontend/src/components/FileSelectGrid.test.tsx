// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FileGridCard, FileListRow } from "@/components/FileSelectGrid";

const file = {
  id: 7,
  path: "/m/a.mkv",
  filename: "a.mkv",
  codec_name: "hevc",
  duration: 65,
  size: 2048,
  scanned_at: null,
};

afterEach(cleanup);

describe("FileGridCard", () => {
  it("renders the default thumbnail, meta row and preview button", () => {
    const { container } = render(
      <FileGridCard file={file} selected={false} onToggle={vi.fn()} onPlay={vi.fn()} />,
    );
    expect(container.querySelector("img")).toBeTruthy();
    expect(screen.getByText("hevc")).toBeTruthy();
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.getByTitle("Preview")).toBeTruthy();
  });

  it("swaps in a custom thumbnail and footer", () => {
    const { container } = render(
      <FileGridCard
        file={file}
        selected={false}
        onToggle={vi.fn()}
        onPlay={vi.fn()}
        thumbnail={<span>custom thumb</span>}
        footer={<span>custom footer</span>}
      />,
    );
    expect(screen.getByText("custom thumb")).toBeTruthy();
    expect(screen.getByText("custom footer")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("hevc")).toBeNull();
  });

  it("hides the preview button when not playable", () => {
    render(
      <FileGridCard
        file={file}
        selected={false}
        onToggle={vi.fn()}
        onPlay={vi.fn()}
        playable={false}
      />,
    );
    expect(screen.queryByTitle("Preview")).toBeNull();
  });

  it("toggles on a body click and previews on the play button only", () => {
    const onToggle = vi.fn();
    const onPlay = vi.fn();
    render(
      <FileGridCard
        file={file}
        selected={false}
        onToggle={onToggle}
        onPlay={onPlay}
        className="extra-class"
      />,
    );
    fireEvent.click(screen.getByText("a.mkv"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Preview"));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".extra-class")).toBeTruthy();
  });

  it("has no select mark and ignores body clicks when not selectable", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <FileGridCard
        file={file}
        selected={false}
        onToggle={onToggle}
        onPlay={vi.fn()}
        selectable={false}
        playable={false}
      />,
    );
    fireEvent.click(screen.getByText("a.mkv"));
    expect(onToggle).not.toHaveBeenCalled();
    // Only the "More actions" trigger remains.
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});

describe("FileListRow", () => {
  it("renders the thumbnail as a play button by default", () => {
    const onPlay = vi.fn();
    render(<FileListRow file={file} selected={false} onToggle={vi.fn()} onPlay={onPlay} />);
    fireEvent.click(screen.getByTitle("Play"));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("has no play affordance when not playable", () => {
    const onPlay = vi.fn();
    const onToggle = vi.fn();
    render(
      <FileListRow
        file={file}
        selected={false}
        onToggle={onToggle}
        onPlay={onPlay}
        playable={false}
        thumbnail={<span>thumb</span>}
      />,
    );
    expect(screen.queryByTitle("Play")).toBeNull();
    fireEvent.click(screen.getByText("thumb"));
    expect(onPlay).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
