import { describe, expect, it } from "vitest";
import { audioCleanupFields } from "./audioCleanupFields";
import type { FieldDef } from "@/hooks/useQueryBuilder";
import type { AudioFile } from "@/types/audio";

const F = Object.fromEntries(audioCleanupFields.map((f) => [f.key, f])) as Record<
  "duration" | "date" | "size" | "filename",
  FieldDef<AudioFile>
>;

function row(over: Partial<AudioFile>): AudioFile {
  return {
    id: 1,
    library_id: 1,
    path: "/x.mp3",
    filename: "x.mp3",
    extension: ".mp3",
    size: 10 * 1024 * 1024,
    duration: 120,
    codec_name: "mp3",
    bitrate: 128000,
    sample_rate: 44100,
    channels: 2,
    channel_layout: "stereo",
    file_date: Math.floor(Date.now() / 1000),
    file_mtime: null,
    status: "done",
    scan_error: null,
    scanned_at: null,
    compressed_at: null,
    created_at: "",
    ...over,
  };
}

describe("audioCleanupFields", () => {
  it("has exactly the four named fields", () => {
    expect(audioCleanupFields.map((f) => f.key).sort()).toEqual([
      "date",
      "duration",
      "filename",
      "size",
    ]);
  });

  it("duration gt / lt", () => {
    expect(F.duration.test!(row({ duration: 40 }), "gt", 30)).toBe(true);
    expect(F.duration.test!(row({ duration: 20 }), "gt", 30)).toBe(false);
    expect(F.duration.test!(row({ duration: 20 }), "lt", 30)).toBe(true);
    expect(F.duration.test!(row({ duration: null }), "lt", 30)).toBe(false);
  });

  it("content date before / after an offset", () => {
    const old = Math.floor(Date.now() / 1000) - 40 * 86400;
    expect(F.date.test!(row({ file_date: old }), "lt", { n: 30, unit: "days" })).toBe(true);
    expect(F.date.test!(row({ file_date: old }), "gt", { n: 30, unit: "days" })).toBe(false);
    expect(F.date.test!(row({ file_date: null }), "lt", { n: 30, unit: "days" })).toBe(false);
  });

  it("file size in MB gt / lt", () => {
    expect(F.size.test!(row({ size: 600 * 1024 * 1024 }), "gt", 500)).toBe(true);
    expect(F.size.test!(row({ size: 50 * 1024 * 1024 }), "gt", 500)).toBe(false);
    expect(F.size.test!(row({ size: 50 * 1024 * 1024 }), "lt", 100)).toBe(true);
  });

  it("filename contains / not_contains / fuzzy", () => {
    expect(
      F.filename.test!(row({ filename: "podcast ep1.mp3" }), "contains", { text: "podcast" }),
    ).toBe(true);
    expect(
      F.filename.test!(row({ filename: "music.mp3" }), "not_contains", { text: "podcast" }),
    ).toBe(true);
    expect(
      F.filename.test!(row({ filename: "the daily show.mp3" }), "fuzzy_contains", {
        text: "the daily show",
        threshold: 80,
      }),
    ).toBe(true);
  });
});
