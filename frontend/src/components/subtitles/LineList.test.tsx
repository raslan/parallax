// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { currentLineIndex } from "@/lib/subtitleLines";
import { LineList } from "./LineList";

const scrollIntoView = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const lines = [
  { start: 5, text: "First line" },
  { start: 65, text: "Second <b>line</b>" },
  { start: 3700, text: "Third line" },
];

describe("currentLineIndex", () => {
  it("is the last line that has started, -1 before the first", () => {
    expect(currentLineIndex(lines, 1)).toBe(-1);
    expect(currentLineIndex(lines, 5)).toBe(0);
    expect(currentLineIndex(lines, 70)).toBe(1);
    expect(currentLineIndex(lines, 99999)).toBe(2);
  });
});

describe("LineList", () => {
  it("seeks to the start of the clicked line", () => {
    const onSeek = vi.fn();
    render(<LineList lines={lines} current={-1} onSeek={onSeek} />);
    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    expect(onSeek).toHaveBeenCalledWith(65);
  });

  it("shows each line's time and renders text as text, never as markup", () => {
    render(<LineList lines={lines} current={-1} onSeek={() => {}} />);
    expect(screen.getByText("0:05")).toBeTruthy();
    expect(screen.getByText("1:01:40")).toBeTruthy();
    expect(screen.getByText("Second <b>line</b>")).toBeTruthy();
  });

  it("marks the current line", () => {
    render(<LineList lines={lines} current={1} onSeek={() => {}} />);
    expect(screen.getByRole("button", { name: /Second/ }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /First/ }).getAttribute("aria-current")).toBeNull();
  });

  it("marks nothing before the first line", () => {
    render(<LineList lines={lines} current={-1} onSeek={() => {}} />);
    expect(document.querySelector("[aria-current]")).toBeNull();
  });

  it("scrolls the current line into view when it changes", () => {
    const { rerender } = render(<LineList lines={lines} current={0} onSeek={() => {}} />);
    scrollIntoView.mockClear();
    rerender(<LineList lines={lines} current={1} onSeek={() => {}} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("button", { name: /Second/ }));
  });

  it("leaves the list alone for a few seconds after the user scrolled it", () => {
    vi.useFakeTimers();
    const { rerender } = render(<LineList lines={lines} current={0} onSeek={() => {}} />);
    scrollIntoView.mockClear();
    fireEvent.wheel(screen.getByRole("list"));
    rerender(<LineList lines={lines} current={1} onSeek={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3100);
    rerender(<LineList lines={lines} current={2} onSeek={() => {}} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
