import { describe, expect, it } from "vitest";
import { qk } from "./queryKeys";

describe("qk prune keys", () => {
  it("narrows by path, and without one is the prefix of every path's key", () => {
    expect(qk.pruneFolder("/r/a")).toEqual(["prune", "folder", "/r/a"]);
    expect(qk.pruneFiles("/r/a")).toEqual(["prune", "files", "/r/a"]);
    expect(qk.pruneFolder()).toEqual(["prune", "folder"]);
    expect(qk.pruneFiles()).toEqual(["prune", "files"]);
  });
});
