import { describe, expect, it } from "vitest";
import type { SubtitleFileInfo } from "@/types/subtitle";
import {
  canMakeMain,
  mainPathOfOriginal,
  startsWithVideoName,
  tidyTargets,
} from "./subtitleManage";

const f = (name: string, kind: SubtitleFileInfo["kind"], label: string | null = null) =>
  ({
    path: `/m/${name}`,
    name,
    language: name.split(".")[1] ?? "en",
    label,
    kind,
    size: 1,
    directory: "",
  }) as SubtitleFileInfo;

describe("subtitleManage", () => {
  it("makes main only a labelled real or hearing-impaired file", () => {
    expect(canMakeMain(f("M.en.subf2m.srt", "real", "subf2m"))).toBe(true);
    expect(canMakeMain(f("M.en.hi.yts.srt", "hearing_impaired", "yts"))).toBe(true);
    expect(canMakeMain(f("M.en.srt", "real"))).toBe(false);
    expect(canMakeMain(f("M.en.generated.srt", "generated", "generated"))).toBe(false);
    expect(canMakeMain(f("M.en.original.srt", "original", "original"))).toBe(false);
  });

  it("names the subtitle a backup belongs to", () => {
    expect(mainPathOfOriginal("/m/M.en.original.srt")).toBe("/m/M.en.srt");
    expect(mainPathOfOriginal("/m/M.en.subf2m.original.srt")).toBe("/m/M.en.subf2m.srt");
  });

  it("counts what each tidy-up would delete, as the server does", () => {
    const files = [
      f("M.en.srt", "real"),
      f("M.en.subf2m.srt", "real", "subf2m"),
      f("M.ar.yts.srt", "real", "yts"),
      f("M.en.generated.srt", "generated", "generated"),
      f("M.ar.translated.srt", "translated", "translated"),
      f("M.en.original.srt", "original", "original"),
    ];
    expect(tidyTargets(files, "generated_translated")).toHaveLength(2);
    // Only a labelled file whose language also has a plain file is an extra version.
    expect(tidyTargets(files, "extra_versions").map((x) => x.name)).toEqual(["M.en.subf2m.srt"]);
    expect(tidyTargets(files, "originals")).toHaveLength(1);
  });

  it("tells whether a new name still starts with the video's name", () => {
    expect(startsWithVideoName("Movie.mkv", "Movie.en.srt")).toBe(true);
    expect(startsWithVideoName("Movie.mkv", "notes.srt")).toBe(false);
    expect(startsWithVideoName("Movie.mkv", "Movie 2.en.srt")).toBe(false);
  });
});
