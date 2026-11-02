import { describe, expect, it } from "vitest";
import { naturalCompare } from "./naturalSort";

describe("naturalCompare", () => {
  it("orders numbers numerically, case-insensitively", () => {
    const names = ["clip10.mp4", "Clip2.mp4", "clip1.mp4"];
    expect([...names].sort(naturalCompare)).toEqual(["clip1.mp4", "Clip2.mp4", "clip10.mp4"]);
  });
});
