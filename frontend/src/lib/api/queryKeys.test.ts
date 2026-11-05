import { describe, expect, it } from "vitest";
import { qk } from "./queryKeys";

describe("qk organize keys", () => {
  it("narrows by path, and without one is the prefix of every path's key", () => {
    expect(qk.organizeFolder("/r/a")).toEqual(["organize", "folder", "/r/a"]);
    expect(qk.organizeFiles("/r/a")).toEqual(["organize", "files", "/r/a"]);
    expect(qk.organizeFolder()).toEqual(["organize", "folder"]);
    expect(qk.organizeFiles()).toEqual(["organize", "files"]);
  });
});
