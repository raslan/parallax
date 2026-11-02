import { describe, it, expect } from "vitest";
import {
  folderAfterDelete,
  folderSearch,
  isWithinRoot,
  normalizeFolderPath,
  resolveOpenFolder,
} from "./pruneNav";

describe("normalizeFolderPath", () => {
  it("keeps a plain absolute path", () => {
    expect(normalizeFolderPath("/media/a b")).toBe("/media/a b");
  });
  it("drops trailing slashes and collapses repeated ones", () => {
    expect(normalizeFolderPath("/media/a/")).toBe("/media/a");
    expect(normalizeFolderPath("/media//a///")).toBe("/media/a");
    expect(normalizeFolderPath("/")).toBe("/");
    expect(normalizeFolderPath("///")).toBe("/");
  });
  it("rejects empty, relative, dot-segment and NUL values", () => {
    for (const bad of ["", "media/a", "./a", "/a/../b", "/a/./b", "/a/..", "/a\0b"]) {
      expect(normalizeFolderPath(bad)).toBeNull();
    }
  });
  it("keeps names with Korean, %, &, # and dots", () => {
    expect(normalizeFolderPath("/m/사진 2024")).toBe("/m/사진 2024");
    expect(normalizeFolderPath("/m/100% & #1")).toBe("/m/100% & #1");
    expect(normalizeFolderPath("/m/...hidden?/a.b")).toBe("/m/...hidden?/a.b");
  });
});

describe("isWithinRoot", () => {
  it("accepts the root and its descendants", () => {
    expect(isWithinRoot("/r", "/r")).toBe(true);
    expect(isWithinRoot("/r/a/b", "/r")).toBe(true);
  });
  it("rejects siblings sharing a prefix and outside paths", () => {
    expect(isWithinRoot("/rx", "/r")).toBe(false);
    expect(isWithinRoot("/other", "/r")).toBe(false);
    expect(isWithinRoot("/", "/r")).toBe(false);
  });
  it("treats / as containing everything", () => {
    expect(isWithinRoot("/a", "/")).toBe(true);
  });
  it("ignores a trailing slash on the root", () => {
    expect(isWithinRoot("/r/a", "/r/")).toBe(true);
  });
});

describe("resolveOpenFolder", () => {
  it("no param opens the root", () => {
    expect(resolveOpenFolder(null, "/r")).toEqual({ path: "/r", valid: true });
  });
  it("opens a normalised folder inside the root", () => {
    expect(resolveOpenFolder("/r/a/", "/r")).toEqual({ path: "/r/a", valid: true });
  });
  it("falls back to the root, flagged invalid, for outside or malformed values", () => {
    expect(resolveOpenFolder("/etc", "/r")).toEqual({ path: "/r", valid: false });
    expect(resolveOpenFolder("/r/../etc", "/r")).toEqual({ path: "/r", valid: false });
    expect(resolveOpenFolder("", "/r")).toEqual({ path: "/r", valid: false });
  });
});

describe("folderSearch", () => {
  it("is empty for the root", () => {
    expect(folderSearch("/r", "/r")).toBe("");
    expect(folderSearch("/r", "/r/")).toBe("");
  });
  it("encodes the path but keeps slashes readable", () => {
    expect(folderSearch("/r/a b", "/r")).toBe("?path=/r/a%20b");
    expect(folderSearch("/r/100% & #1+x", "/r")).toBe("?path=/r/100%25%20%26%20%231%2Bx");
  });
  it("round-trips through URLSearchParams", () => {
    for (const p of ["/r/사진 2024", "/r/100% & #1+x", "/r/a=b?c"]) {
      const parsed = new URLSearchParams(folderSearch(p, "/r")).get("path");
      expect(parsed).toBe(p);
    }
  });
});

describe("folderAfterDelete", () => {
  it("returns the deleted folder's parent when the open folder is it or inside it", () => {
    expect(folderAfterDelete("/r/a", "/r/a")).toBe("/r");
    expect(folderAfterDelete("/r/a", "/r/a/b/c")).toBe("/r");
  });
  it("returns null when the open folder survives", () => {
    expect(folderAfterDelete("/r/a", "/r")).toBeNull();
    expect(folderAfterDelete("/r/a", "/r/ab")).toBeNull();
    expect(folderAfterDelete("/r/a", "/r/b")).toBeNull();
  });
});
