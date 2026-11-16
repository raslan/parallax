import { describe, expect, it } from "vitest";
import type { LengthInfo, ScanFile, SubtitleFileInfo, SubtitleKind } from "@/types/subtitle";
import { attention, blockedReasons, coverage, lengthKey, hasSubtitle } from "./subtitleCoverage";

describe("blockedReasons", () => {
  it("gives a reason only when nothing is installed", () => {
    expect(blockedReasons({ speechModelReady: false, packsInstalled: 0 })).toEqual({
      translate: "Install a language pack in Settings → Subtitles",
      generate: "Install or choose a speech model in Settings → Subtitles",
    });
    expect(blockedReasons({ speechModelReady: true, packsInstalled: 1 })).toEqual({
      translate: null,
      generate: null,
    });
  });

  it("never blocks while the lists are loading or could not be read", () => {
    // null = not known yet (loading) or the read failed: unknown is not "none installed".
    expect(blockedReasons({ speechModelReady: null, packsInstalled: null })).toEqual({
      translate: null,
      generate: null,
    });
  });
});

describe("hasSubtitle", () => {
  it("is true only for a video with a subtitle other than a .original backup", () => {
    const p = "/m/a.mkv";
    expect(hasSubtitle(file(p))).toBe(false);
    expect(hasSubtitle(file(p, [sub(p, "en", "original")]))).toBe(false);
    expect(hasSubtitle(file(p, [sub(p, "en", "generated")]))).toBe(true);
  });
});

const sub = (
  video: string,
  language: string,
  kind: SubtitleKind,
  size = 100,
): SubtitleFileInfo => ({
  path: `${video}.${language}.${kind}.srt`,
  name: `x.${language}.srt`,
  language,
  label: null,
  kind,
  size,
  directory: "",
});

const file = (path: string, subtitles: SubtitleFileInfo[] = []): ScanFile => ({
  path,
  filename: path.split("/").pop() ?? path,
  relative_dir: "",
  subtitles,
  title: "Show",
  season: 1,
  episode: 1,
  year: null,
  media_type: "episode",
});

/** 34 episodes: a real English subtitle on 28, a generated English one on 1, no Arabic. */
function fixture(): ScanFile[] {
  return Array.from({ length: 34 }, (_, i) => {
    const p = `/tv/Show/e${i}.mkv`;
    if (i < 28) return file(p, [sub(p, "en", i % 2 ? "hearing_impaired" : "real")]);
    if (i === 28) return file(p, [sub(p, "en", "generated")]);
    return file(p);
  });
}

describe("coverage", () => {
  it("counts real, generated and translated per wanted language", () => {
    const c = coverage(fixture(), ["en", "ar"]);
    expect(c.en).toEqual({ real: 28, generated: 1, translated: 0, total: 34 });
    expect(c.ar).toEqual({ real: 0, generated: 0, translated: 0, total: 34 });
  });

  it("counts a file once per kind even with several files of that kind", () => {
    const p = "/m/a.mkv";
    const c = coverage([file(p, [sub(p, "en", "real"), sub(p, "en", "real", 5)])], ["en"]);
    expect(c.en?.real).toBe(1);
  });

  it("ignores .original backups and matches the language case-insensitively", () => {
    const p = "/m/a.mkv";
    const c = coverage(
      [file(p, [sub(p, "en", "original")]), file("/m/b.mkv", [sub("/m/b.mkv", "EN", "real")])],
      ["en"],
    );
    expect(c.en).toEqual({ real: 1, generated: 0, translated: 0, total: 2 });
  });
});

describe("attention", () => {
  it("lists files missing a real subtitle, never one that has a real subtitle", () => {
    const a = attention(fixture(), ["en"]);
    expect(a.missing.size).toBe(6);
    expect(a.missing.has("/tv/Show/e0.mkv")).toBe(false);
    expect(a.missing.has("/tv/Show/e28.mkv")).toBe(true);
  });

  it("a file with only a generated subtitle is machine-only", () => {
    const a = attention(fixture(), ["en"]);
    expect([...a.machineOnly]).toEqual(["/tv/Show/e28.mkv"]);
  });

  it("looks short from the length check, and has a backup from an .original file", () => {
    const p = "/m/a.mkv";
    const files = [file(p, [sub(p, "en", "real"), sub(p, "en", "original")]), file("/m/b.mkv")];
    const lengths: Record<string, LengthInfo | null> = {
      [p]: { duration: 3070, subtitles: [{ path: "s", last_cue: 2462, length: "short" }] },
      "/m/b.mkv": null,
    };
    const a = attention(files, ["en"], lengths);
    expect([...a.looksShort]).toEqual([p]);
    expect([...a.hasBackup]).toEqual([p]);
    expect([...a.missing]).toEqual(["/m/b.mkv"]);
  });
});

describe("lengthKey", () => {
  it("changes when a subtitle file is added or changes size", () => {
    const p = "/m/a.mkv";
    const one = lengthKey(file(p, [sub(p, "en", "real", 10)]));
    const grown = lengthKey(file(p, [sub(p, "en", "real", 11)]));
    const more = lengthKey(file(p, [sub(p, "en", "real", 10), sub(p, "ar", "real", 1)]));
    expect(one.path).toBe(p);
    expect(
      new Set([
        `${one.size}:${one.mtime}`,
        `${grown.size}:${grown.mtime}`,
        `${more.size}:${more.mtime}`,
      ]).size,
    ).toBe(3);
  });
});
