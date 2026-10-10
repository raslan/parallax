import { describe, expect, it } from "vitest";
import type { VideoFile } from "@/types/file";
import { defaultOutputName, moveItem, naturalCompare, sortOrder, syncOrder } from "./spliceOrder";

const f = (id: number, filename: string, duration = 10, file_date: number | null = null) =>
  ({ id, filename, duration, file_date }) as VideoFile;
const byId = (...files: VideoFile[]) => new Map(files.map((x) => [x.id, x]));

describe("naturalCompare", () => {
  it("orders numbers numerically, case-insensitively", () => {
    const names = ["clip10.mp4", "Clip2.mp4", "clip1.mp4"];
    expect([...names].sort(naturalCompare)).toEqual(["clip1.mp4", "Clip2.mp4", "clip10.mp4"]);
  });
});

describe("sortOrder", () => {
  const m = byId(f(1, "b.mp4", 30, 5), f(2, "a.mp4", 10, 9), f(3, "c.mp4", 20, null));
  it("sorts by name / duration / date and reverses", () => {
    expect(sortOrder([1, 2, 3], m, "name", false)).toEqual([2, 1, 3]);
    expect(sortOrder([1, 2, 3], m, "duration", false)).toEqual([2, 3, 1]);
    expect(sortOrder([1, 2, 3], m, "date", false)).toEqual([3, 1, 2]); // null date first
    expect(sortOrder([1, 2, 3], m, "name", true)).toEqual([3, 1, 2]);
  });
});

describe("syncOrder", () => {
  const m = byId(f(1, "a.mp4"), f(2, "b.mp4"), f(3, "c10.mp4"), f(4, "c2.mp4"));
  it("keeps existing order, drops deselected, appends new naturally sorted", () => {
    expect(syncOrder([2, 1], new Set([1, 2, 3, 4]), m)).toEqual([2, 1, 4, 3]);
    expect(syncOrder([2, 1, 4], new Set([1, 4]), m)).toEqual([1, 4]);
    expect(syncOrder([], new Set([3, 1]), m)).toEqual([1, 3]);
  });
});

describe("defaultOutputName", () => {
  it("uses the longest common prefix trimmed of separators", () => {
    expect(defaultOutputName([f(1, "Trip - Day 1.mp4"), f(2, "Trip - Day 2.mp4")])).toBe(
      "Trip - Day",
    );
  });
  it("falls back to first name + (merged)", () => {
    expect(defaultOutputName([f(1, "alpha.mp4"), f(2, "beta.mp4")])).toBe("alpha (merged)");
  });
});

describe("moveItem", () => {
  it("moves without mutating", () => {
    const a = [1, 2, 3];
    expect(moveItem(a, 0, 2)).toEqual([2, 3, 1]);
    expect(a).toEqual([1, 2, 3]);
  });
});
