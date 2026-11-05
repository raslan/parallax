import { describe, it, expect } from "vitest";
import { evaluateClauses, type Clause, type FieldDef } from "@/hooks/useQueryBuilder";
import type { FileDetails, OrganizeFile } from "@/types/organize";
import { organizeFields } from "./organizeSearch";

type Row = OrganizeFile & { details?: FileDetails | null };

const byKey = Object.fromEntries(organizeFields.map((f) => [f.key, f])) as Record<
  string,
  FieldDef<Row>
>;

function row(over: Partial<Row> = {}): Row {
  return {
    name: "Holiday Clip.MP4",
    path: "/r/Holiday Clip.MP4",
    kind: "video",
    size: 100 * 1024 * 1024,
    mtime: 1_700_000_000,
    ...over,
  };
}

const details = (over: Partial<FileDetails> = {}): FileDetails => ({
  duration: 120,
  width: 1920,
  height: 1080,
  codec: "h264",
  bitrate: 5_000_000,
  ...over,
});

function run(key: string, operator: Clause["operator"], value: unknown, r: Row) {
  const clause: Clause = { id: "c", fieldKey: key, operator, value, joinToNext: "AND" };
  return evaluateClauses([clause], r, byKey, {});
}

const text = (t: string) => ({ text: t });

describe("organizeFields keys", () => {
  it("exposes the expected fields", () => {
    expect(organizeFields.map((f) => f.key)).toEqual([
      "name",
      "extension",
      "kind",
      "size",
      "file_added",
      "duration",
      "resolution",
      "orientation",
      "codec",
      "bitrate",
    ]);
  });
  it("shares Cleanup's labels and operators where the fields overlap", () => {
    expect(byKey.file_added!.label).toBe("File added");
    expect(byKey.resolution!.unitLabel).toBe("px short side");
    expect(byKey.name!.operators).toEqual([
      "contains",
      "not_contains",
      "fuzzy_contains",
      "starts_with",
      "ends_with",
      "eq",
      "regex",
    ]);
  });
});

describe("orientation field", () => {
  it("derives landscape / portrait / square from the probed size", () => {
    const of = (width: number, height: number) => row({ details: details({ width, height }) });
    expect(run("orientation", "eq", "landscape", of(1920, 1080))).toBe(true);
    expect(run("orientation", "eq", "portrait", of(1920, 1080))).toBe(false);
    expect(run("orientation", "eq", "portrait", of(1080, 1920))).toBe(true);
    expect(run("orientation", "eq", "square", of(720, 720))).toBe(true);
    expect(run("orientation", "eq", "landscape", of(720, 720))).toBe(false);
  });
  it("is false without details or dimensions", () => {
    expect(run("orientation", "eq", "landscape", row())).toBe(false);
    expect(run("orientation", "eq", "landscape", row({ details: null }))).toBe(false);
    const noH = row({ details: details({ height: null }) });
    expect(run("orientation", "eq", "landscape", noH)).toBe(false);
  });
});

describe("name field", () => {
  it("contains is case-insensitive", () => {
    expect(run("name", "contains", text("holiday"), row())).toBe(true);
    expect(run("name", "contains", text("nope"), row())).toBe(false);
  });
  it("trims the query like Cleanup's filename field", () => {
    expect(run("name", "contains", text("  holiday  "), row())).toBe(true);
    expect(run("name", "eq", text(" holiday clip.mp4 "), row())).toBe(true);
  });
  it("fuzzy_contains uses the shared bigram similarity", () => {
    expect(run("name", "fuzzy_contains", text("holidy clip"), row())).toBe(true);
    expect(run("name", "fuzzy_contains", { text: "holidy clip", threshold: 99 }, row())).toBe(
      false,
    );
    expect(run("name", "fuzzy_contains", text("zzzz"), row())).toBe(false);
  });
  it("not_contains negates", () => {
    expect(run("name", "not_contains", text("holiday"), row())).toBe(false);
    expect(run("name", "not_contains", text("nope"), row())).toBe(true);
  });
  it("starts_with / ends_with", () => {
    expect(run("name", "starts_with", text("HOLIDAY"), row())).toBe(true);
    expect(run("name", "starts_with", text("clip"), row())).toBe(false);
    expect(run("name", "ends_with", text(".mp4"), row())).toBe(true);
    expect(run("name", "ends_with", text("holiday"), row())).toBe(false);
  });
  it("eq matches the whole name case-insensitively", () => {
    expect(run("name", "eq", text("holiday clip.mp4"), row())).toBe(true);
    expect(run("name", "eq", text("holiday clip"), row())).toBe(false);
  });
  it("regex matches case-insensitively", () => {
    expect(run("name", "regex", text("^holiday\\s+clip"), row())).toBe(true);
    expect(run("name", "regex", text("^clip"), row())).toBe(false);
  });
  it("invalid regex matches nothing and never throws", () => {
    expect(() => run("name", "regex", text("([unclosed"), row())).not.toThrow();
    expect(run("name", "regex", text("([unclosed"), row())).toBe(false);
  });
  it("matches decomposed Hangul names against composed queries and back", () => {
    const nfd = row({ name: "카리나 직캠.mp4".normalize("NFD") });
    const nfc = row({ name: "카리나 직캠.mp4" });
    expect(run("name", "contains", text("카리나"), nfd)).toBe(true);
    expect(run("name", "starts_with", text("카리나"), nfd)).toBe(true);
    expect(run("name", "contains", text("카리나".normalize("NFD")), nfc)).toBe(true);
    expect(run("name", "eq", text("카리나 직캠.mp4"), nfd)).toBe(true);
    expect(run("name", "regex", text("^카리나"), nfd)).toBe(true);
  });
  it("handles unicode names", () => {
    const r = row({ name: "에스파 카리나 직캠.mp4" });
    expect(run("name", "contains", text("카리나"), r)).toBe(true);
    expect(run("name", "starts_with", text("에스파"), r)).toBe(true);
    expect(run("name", "regex", text("카리나.*직캠"), r)).toBe(true);
    expect(run("name", "contains", text("윈터"), r)).toBe(false);
  });
});

describe("extension and kind", () => {
  it("extension eq ignores case and leading dot", () => {
    expect(run("extension", "eq", text("mp4"), row())).toBe(true);
    expect(run("extension", "eq", text(".MP4"), row())).toBe(true);
    expect(run("extension", "eq", text("mkv"), row())).toBe(false);
    expect(run("extension", "neq", text("mkv"), row())).toBe(true);
  });
  it("extension of a file with no dot is empty", () => {
    expect(run("extension", "eq", text("README"), row({ name: "README" }))).toBe(false);
  });
  it("kind eq / neq", () => {
    expect(run("kind", "eq", "video", row())).toBe(true);
    expect(run("kind", "eq", "image", row())).toBe(false);
    expect(run("kind", "neq", "image", row())).toBe(true);
  });
});

describe("numeric fields", () => {
  it("size is compared in MB", () => {
    expect(run("size", "gt", 50, row())).toBe(true);
    expect(run("size", "lt", 50, row())).toBe(false);
  });
  it("file added (mtime) compares against an offset cutoff", () => {
    const old = row({ mtime: 1 });
    expect(run("file_added", "lt", { n: 30, unit: "days" }, old)).toBe(true);
    expect(run("file_added", "gt", { n: 30, unit: "days" }, old)).toBe(false);
  });
});

describe("enriched fields", () => {
  it("return false when details are missing", () => {
    for (const [key, op, val] of [
      ["duration", "gt", 1],
      ["duration", "lt", 1000],
      ["resolution", "gt", 1],
      ["resolution", "lt", 99999],
      ["codec", "eq", text("h264")],
      ["bitrate", "gt", 1],
    ] as const) {
      expect(run(key, op, val, row())).toBe(false);
      expect(run(key, op, val, row({ details: null }))).toBe(false);
    }
  });
  it("return false when the specific detail is null", () => {
    const r = row({
      details: details({ duration: null, height: null, codec: null, bitrate: null }),
    });
    expect(run("duration", "gt", 1, r)).toBe(false);
    expect(run("resolution", "gt", 1, r)).toBe(false);
    expect(run("codec", "contains", text("h"), r)).toBe(false);
    expect(run("bitrate", "gt", 1, r)).toBe(false);
  });
  it("compare when details exist", () => {
    const r = row({ details: details() });
    expect(run("duration", "gt", 60, r)).toBe(true);
    expect(run("duration", "lt", 60, r)).toBe(false);
    expect(run("resolution", "lt", 1440, r)).toBe(true);
    expect(run("resolution", "gt", 1080, r)).toBe(false);
    expect(run("codec", "eq", text("H264"), r)).toBe(true);
    expect(run("codec", "contains", text("264"), r)).toBe(true);
    expect(run("codec", "not_contains", text("hevc"), r)).toBe(true);
    expect(run("bitrate", "gt", 4000, r)).toBe(true); // kbps
    expect(run("bitrate", "lt", 4000, r)).toBe(false);
  });
  it("matches images, whose details carry only dimensions and a format", () => {
    const img = row({
      name: "photo.jpg",
      kind: "image",
      details: { duration: null, width: 4000, height: 3000, codec: "jpeg", bitrate: null },
    });
    expect(run("resolution", "gt", 2160, img)).toBe(true);
    expect(run("resolution", "lt", 2160, img)).toBe(false);
    expect(run("orientation", "eq", "landscape", img)).toBe(true);
    expect(run("orientation", "eq", "portrait", img)).toBe(false);
    expect(run("codec", "eq", text("JPEG"), img)).toBe(true);
    // No duration/bitrate on a still: those clauses must simply not match.
    expect(run("duration", "gt", 0, img)).toBe(false);
    expect(run("bitrate", "gt", 0, img)).toBe(false);
  });
  it("resolution compares the shortest side, the same as Cleanup", () => {
    const r = row({ details: details({ width: 1080, height: 1920 }) });
    expect(run("resolution", "gt", 1440, r)).toBe(false);
    expect(run("resolution", "lt", 1440, r)).toBe(true);
  });
});
