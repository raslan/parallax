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

  it("shows the wanted languages once known", () => {
    render(<FolderStrip {...props} wanted={["en", "ar"]} />);
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByText("Arabic")).toBeTruthy();
  });
});
