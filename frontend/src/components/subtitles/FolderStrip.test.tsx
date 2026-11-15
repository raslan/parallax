// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FolderStrip } from "./FolderStrip";

afterEach(cleanup);

const props = {
  folder: "/tv",
  scanning: false,
  onOpen: vi.fn(),
  onRescan: vi.fn(),
  onWantedChange: vi.fn(),
  sources: ["subf2m", "yts"] as ("subf2m" | "yts")[],
  onSourcesChange: vi.fn(),
  ytsReason: null,
};

describe("FolderStrip", () => {
  it("shows no Wanted chips until the Settings languages are known", () => {
    render(<FolderStrip {...props} wanted={null} />);
    expect(screen.queryByText("English")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a wanted language" })).toBeNull();
  });

  it("says so when no source is on, and stays quiet otherwise", () => {
    const { rerender } = render(<FolderStrip {...props} wanted={["en"]} sources={[]} />);
    expect(screen.getByText("Turn on at least one source to search")).toBeTruthy();
    rerender(<FolderStrip {...props} wanted={["en"]} sources={["subf2m"]} />);
    expect(screen.queryByText("Turn on at least one source to search")).toBeNull();
    // YTS left on but unavailable for TV counts as off
    rerender(<FolderStrip {...props} wanted={["en"]} sources={["yts"]} ytsReason="Films only" />);
    expect(screen.getByText("Turn on at least one source to search")).toBeTruthy();
  });

  it("shows the wanted languages once known", () => {
    render(<FolderStrip {...props} wanted={["en", "ar"]} />);
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByText("Arabic")).toBeTruthy();
  });
});
