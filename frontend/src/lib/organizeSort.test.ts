import { describe, expect, it } from "vitest";
import { fileSortDefaultDir, folderSortDefaultDir, sortFiles, sortFolders } from "./organizeSort";
import type { Counts, FileDetails, FolderNodeInfo, OrganizeFile } from "@/types/organize";

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

  it("defaults name to ascending and counts to descending", () => {
    expect(folderSortDefaultDir("name")).toBe("asc");
    expect(folderSortDefaultDir("files")).toBe("desc");
    expect(folderSortDefaultDir("size")).toBe("desc");
  });
});

describe("sortFiles", () => {
  const f = (name: string, over: Partial<OrganizeFile> = {}): OrganizeFile => ({
    name,
    path: `/r/${name}`,
    kind: "video",
    size: 0,
    mtime: 0,
    ...over,
  });
  const d = (over: Partial<FileDetails> = {}): FileDetails => ({
    duration: null,
    width: null,
    height: null,
    codec: null,
    bitrate: null,
    ...over,
  });
  const fileNames = (fs: OrganizeFile[]) => fs.map((x) => x.name);

  it("sorts by name naturally, Korean included", () => {
    const fs = [f("clip10"), f("clip2"), f("다"), f("가"), f("clip1")];
    const asc = fileNames(sortFiles(fs, {}, "name", "asc"));
    expect(asc.slice(0, 3)).toEqual(["clip1", "clip2", "clip10"]);
    expect(asc.indexOf("가")).toBeLessThan(asc.indexOf("다"));
    expect(fileNames(sortFiles(fs, {}, "name", "desc"))).toEqual([...asc].reverse());
  });

  it("sorts by size, file added and kind", () => {
    const fs = [
      f("a", { size: 3, mtime: 10, kind: "other" }),
      f("b", { size: 1, mtime: 30, kind: "image" }),
      f("c", { size: 2, mtime: 20, kind: "video" }),
    ];
    expect(fileNames(sortFiles(fs, {}, "size", "desc"))).toEqual(["a", "c", "b"]);
    expect(fileNames(sortFiles(fs, {}, "added", "asc"))).toEqual(["a", "c", "b"]);
    expect(fileNames(sortFiles(fs, {}, "kind", "asc"))).toEqual(["c", "b", "a"]);
  });

  it("sorts details-backed keys with files lacking the value last, either way", () => {
    const fs = [f("none"), f("short"), f("nul"), f("long"), f("still")];
    const details = {
      "/r/short": d({ duration: 10, width: 640, height: 480, codec: "h264", bitrate: 1 }),
      "/r/nul": null,
      "/r/long": d({ duration: 99, width: 1920, height: 1080, codec: "hevc", bitrate: 9 }),
      "/r/still": d({ width: 4000, height: 3000, codec: "jpeg" }),
    };
    expect(fileNames(sortFiles(fs, details, "duration", "asc"))).toEqual([
      "short",
      "long",
      "none",
      "nul",
      "still",
    ]);
    expect(fileNames(sortFiles(fs, details, "duration", "desc"))).toEqual([
      "long",
      "short",
      "none",
      "nul",
      "still",
    ]);
    expect(fileNames(sortFiles(fs, details, "resolution", "desc"))).toEqual([
      "still",
      "long",
      "short",
      "none",
      "nul",
    ]);
    expect(fileNames(sortFiles(fs, details, "codec", "asc"))).toEqual([
      "short",
      "long",
      "still",
      "none",
      "nul",
    ]);
    expect(fileNames(sortFiles(fs, details, "bitrate", "desc"))).toEqual([
      "long",
      "short",
      "none",
      "nul",
      "still",
    ]);
  });

  it("keeps input order for ties in both directions and does not mutate", () => {
    const fs = [f("x", { size: 1 }), f("y", { size: 1 }), f("z", { size: 1 })];
    const copy = [...fs];
    expect(fileNames(sortFiles(fs, {}, "size", "asc"))).toEqual(["x", "y", "z"]);
    expect(fileNames(sortFiles(fs, {}, "size", "desc"))).toEqual(["x", "y", "z"]);
    expect(fs).toEqual(copy);
  });

  it("defaults name/kind/codec to ascending and the measures to descending", () => {
    expect(["name", "kind", "codec"].map((k) => fileSortDefaultDir(k as never))).toEqual([
      "asc",
      "asc",
      "asc",
    ]);
    expect(
      ["size", "added", "duration", "resolution", "bitrate"].map((k) =>
        fileSortDefaultDir(k as never),
      ),
    ).toEqual(["desc", "desc", "desc", "desc", "desc"]);
  });
});
