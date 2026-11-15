// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LineList } from "./LineList";

afterEach(cleanup);

const lines = [
  { start: 5, text: "First line" },
  { start: 65, text: "Second <b>line</b>" },
  { start: 3700, text: "Third line" },
];

describe("LineList", () => {
  it("seeks to the start of the clicked line", () => {
    const onSeek = vi.fn();
    render(<LineList lines={lines} currentTime={0} onSeek={onSeek} />);
    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    expect(onSeek).toHaveBeenCalledWith(65);
  });

  it("shows each line's time and renders text as text, never as markup", () => {
    render(<LineList lines={lines} currentTime={0} onSeek={() => {}} />);
    expect(screen.getByText("0:05")).toBeTruthy();
    expect(screen.getByText("1:01:40")).toBeTruthy();
    expect(screen.getByText("Second <b>line</b>")).toBeTruthy();
  });

  it("marks the line the player is on as current", () => {
    render(<LineList lines={lines} currentTime={70} onSeek={() => {}} />);
    expect(screen.getByRole("button", { name: /Second/ }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /First/ }).getAttribute("aria-current")).toBeNull();
  });

  it("marks nothing before the first line", () => {
    render(<LineList lines={lines} currentTime={1} onSeek={() => {}} />);
    expect(document.querySelector("[aria-current]")).toBeNull();
  });
});
