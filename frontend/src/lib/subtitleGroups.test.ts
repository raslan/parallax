import { describe, expect, it } from "vitest";
import type { ScanFile, TitleGroup } from "@/types/subtitle";
import { groupFiles, seasonCount, sortTitleFiles, titleStatus } from "./subtitleGroups";

const file = (path: string, season: number | null = null): ScanFile => ({
  path,
  filename: path.split("/").pop() ?? path,
  relative_dir: "",
  has_subtitle: false,
  has_any_subtitle: false,
  languages: {},
  machine_languages: {},
  subtitles: [],
  title: "",
  season,
  episode: null,
  year: null,
  media_type: "episode",
});

const group = (key: string, files: string[], extra: Partial<TitleGroup> = {}): TitleGroup => ({
  key,
  title: key,
  year: null,
  type: "tv",
  files,
  layout_clean: false,
  needs_choice: false,
  ...extra,
});

describe("groupFiles", () => {
  it("keeps the groups' order and each group's file order", () => {
    const files = [file("/a/1"), file("/a/2"), file("/b/1"), file("/b/2")];
    const out = groupFiles(files, [group("b", ["/b/2", "/b/1"]), group("a", ["/a/1", "/a/2"])]);
    expect(out.map((g) => g.group.key)).toEqual(["b", "a"]);
    expect(out[0]!.files.map((f) => f.path)).toEqual(["/b/2", "/b/1"]);
    expect(out[1]!.files.map((f) => f.path)).toEqual(["/a/1", "/a/2"]);
  });

  it("drops paths the scan does not have and groups left empty", () => {
    const out = groupFiles(
      [file("/a/1")],
      [group("a", ["/a/1", "/a/gone"]), group("z", ["/z/gone"])],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.files.map((f) => f.path)).toEqual(["/a/1"]);
  });
});

describe("titleStatus", () => {
  it("names the layout, the choice and the skip", () => {
    expect(titleStatus(group("a", [], { layout_clean: true }), false)).toBe("Layout looks right");
    expect(titleStatus(group("a", [], { needs_choice: true }), false)).toBe("Pick which one");
    expect(titleStatus(group("a", [], { layout_clean: true }), true)).toBe("Skipped");
    expect(titleStatus(group("a", []), false)).toBeNull();
  });
});

describe("sortTitleFiles", () => {
  it("orders by season and episode, files without either last, ties by natural name", () => {
    const ep = (path: string, season: number | null, episode: number | null) => ({
      ...file(path, season),
      episode,
    });
    const files = [ep("/x", null, null), ep("/s2e1", 2, 1), ep("/s1e10", 1, 10), ep("/s1e2", 1, 2)];
    expect(sortTitleFiles(files, "episode", "asc").map((f) => f.path)).toEqual([
      "/s1e2",
      "/s1e10",
      "/s2e1",
      "/x",
    ]);
    const named = [file("/a/Ep 10"), file("/a/Ep 2")];
    expect(sortTitleFiles(named, "name", "asc").map((f) => f.filename)).toEqual(["Ep 2", "Ep 10"]);
    expect(sortTitleFiles(named, "name", "desc").map((f) => f.filename)).toEqual(["Ep 10", "Ep 2"]);
  });
});

describe("seasonCount", () => {
  it("counts distinct seasons, ignoring files without one", () => {
    expect(seasonCount([file("/1", 1), file("/2", 1), file("/3", 2), file("/4")])).toBe(2);
  });
});
