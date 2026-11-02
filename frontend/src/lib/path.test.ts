import { describe, expect, it } from "vitest";
import { baseName, extensionOf, parentPath } from "./path";

describe("parentPath", () => {
  it("returns the parent of a path, never empty", () => {
    expect(parentPath("/r/a/b")).toBe("/r/a");
    expect(parentPath("/r")).toBe("/");
  });
});

describe("baseName", () => {
  it("returns the last component, ignoring a trailing slash", () => {
    expect(baseName("/r/a/Season 1")).toBe("Season 1");
    expect(baseName("/r/a/")).toBe("a");
    expect(baseName("/")).toBe("/");
  });
});

describe("extensionOf", () => {
  it("is the lower-cased extension without the dot", () => {
    expect(extensionOf("clip.MP4")).toBe("mp4");
    expect(extensionOf("a.tar.gz")).toBe("gz");
  });

  it("is empty for no extension or a leading-dot name", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf(".bashrc")).toBe("");
  });
});
