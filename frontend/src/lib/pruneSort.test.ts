import { describe, expect, it } from "vitest";
import { sortFolders } from "./pruneSort";
import type { Counts, FolderNodeInfo } from "@/types/prune";

const counts = (files: number, bytes: number): Counts => ({
  files,
  images: 0,
  videos: 0,
  audio: 0,
  other: 0,
  bytes,
});

const folder = (name: string, files = 0, bytes = 0): FolderNodeInfo => ({
  name,
  path: `/r/${name}`,
  direct: counts(0, 0),
  total: counts(files, bytes),
});

const names = (fs: FolderNodeInfo[]) => fs.map((f) => f.name);

describe("sortFolders", () => {
  const input = [folder("a", 5, 300), folder("b", 50, 100), folder("c", 20, 900)];

  it("sorts by file count", () => {
    expect(names(sortFolders(input, "files", "desc"))).toEqual(["b", "c", "a"]);
    expect(names(sortFolders(input, "files", "asc"))).toEqual(["a", "c", "b"]);
  });

  it("sorts by size", () => {
    expect(names(sortFolders(input, "size", "desc"))).toEqual(["c", "a", "b"]);
    expect(names(sortFolders(input, "size", "asc"))).toEqual(["b", "a", "c"]);
  });

  it("sorts by name naturally", () => {
    const fs = [folder("Season 10"), folder("Season 2"), folder("Season 1")];
    expect(names(sortFolders(fs, "name", "asc"))).toEqual(["Season 1", "Season 2", "Season 10"]);
    expect(names(sortFolders(fs, "name", "desc"))).toEqual(["Season 10", "Season 2", "Season 1"]);
  });

  it("handles Korean names without throwing", () => {
    const fs = [folder("나나"), folder("가가"), folder("다다"), folder("abc")];
    const out = names(sortFolders(fs, "name", "asc"));
    expect(out).toHaveLength(4);
    expect(out.indexOf("가가")).toBeLessThan(out.indexOf("나나"));
    expect(out.indexOf("나나")).toBeLessThan(out.indexOf("다다"));
  });

  it("keeps input order for ties in both directions", () => {
    const ties = [folder("x", 3), folder("y", 3), folder("z", 3)];
    expect(names(sortFolders(ties, "files", "asc"))).toEqual(["x", "y", "z"]);
    expect(names(sortFolders(ties, "files", "desc"))).toEqual(["x", "y", "z"]);
  });

  it("does not mutate its input", () => {
    const copy = [...input];
    sortFolders(input, "files", "asc");
    expect(input).toEqual(copy);
  });
});
