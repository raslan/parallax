import { describe, it, expect } from "vitest";
import { folderCardWidth } from "./organizeGrid";

const FOLDER_MIN_WIDTH = 200;
const FOLDER_MAX_WIDTH = 400;

describe("folderCardWidth", () => {
  it("passes in-range sizes through", () => {
    expect(folderCardWidth(240)).toBe(240);
    expect(folderCardWidth(FOLDER_MIN_WIDTH)).toBe(FOLDER_MIN_WIDTH);
    expect(folderCardWidth(FOLDER_MAX_WIDTH)).toBe(FOLDER_MAX_WIDTH);
  });

  it("clamps small slider values up and large ones down", () => {
    expect(folderCardWidth(120)).toBe(FOLDER_MIN_WIDTH);
    expect(folderCardWidth(360)).toBe(360);
    expect(folderCardWidth(900)).toBe(FOLDER_MAX_WIDTH);
  });

  it("falls back to the minimum for a corrupt stored size", () => {
    expect(folderCardWidth(Number.NaN)).toBe(FOLDER_MIN_WIDTH);
  });
});
