import { describe, it, expect } from "vitest";
import type { Operator } from "@/hooks/useQueryBuilder";
import {
  bigramSimilarity,
  dateField,
  durationField,
  filenameField,
  orientationField,
  resolutionField,
  sizeField,
} from "./fileFieldFactories";

type Row = { n?: number | null; w?: number | null; h?: number | null; name?: string };
const run = (f: ReturnType<typeof durationField<Row>>, row: Row, op: Operator, v: unknown) =>
  f.test!(row, op, v);

describe("durationField", () => {
  const f = durationField<Row>((r) => r.n);
  it("compares gt / lt and never matches a missing value", () => {
    expect(f.key).toBe("duration");
    expect(run(f, { n: 40 }, "gt", 30)).toBe(true);
    expect(run(f, { n: 20 }, "gt", 30)).toBe(false);
    expect(run(f, { n: 20 }, "lt", 30)).toBe(true);
    expect(run(f, { n: null }, "lt", 30)).toBe(false);
    expect(run(f, {}, "gt", 0)).toBe(false);
  });
});

describe("dateField", () => {
  const f = dateField<Row>("file_added", "File added", (r) => r.n);
  const old = Math.floor(Date.now() / 1000) - 40 * 86400;
  it("is before / after an offset cutoff, false when missing", () => {
    expect([f.key, f.label, f.valueType]).toEqual(["file_added", "File added", "date_offset"]);
    expect(run(f, { n: old }, "lt", { n: 30, unit: "days" })).toBe(true);
    expect(run(f, { n: old }, "gt", { n: 30, unit: "days" })).toBe(false);
    expect(run(f, { n: null }, "lt", { n: 30, unit: "days" })).toBe(false);
  });
});

describe("sizeField", () => {
  const presets = [{ label: "1 GB", value: 1000 }];
  const f = sizeField<Row>((r) => (r.n ?? 0) * 1024 * 1024, { defaultValue: 7, presets });
  it("compares in MB and carries the page's default and presets", () => {
    expect([f.key, f.defaultValue, f.presets]).toEqual(["size", 7, presets]);
    expect(run(f, { n: 100 }, "gt", 50)).toBe(true);
    expect(run(f, { n: 100 }, "lt", 50)).toBe(false);
  });
});

describe("orientationField", () => {
  const f = orientationField<Row>(
    (r) => r.w,
    (r) => r.h,
  );
  it("derives landscape / portrait / square, false without both sides", () => {
    expect(run(f, { w: 1920, h: 1080 }, "eq", "landscape")).toBe(true);
    expect(run(f, { w: 1080, h: 1920 }, "eq", "portrait")).toBe(true);
    expect(run(f, { w: 720, h: 720 }, "eq", "square")).toBe(true);
    expect(run(f, { w: 720, h: 720 }, "eq", "landscape")).toBe(false);
    expect(run(f, { w: 720, h: null }, "eq", "landscape")).toBe(false);
  });
});

describe("resolutionField", () => {
  const f = resolutionField<Row>(
    (r) => r.w,
    (r) => r.h,
  );
  it("compares the shortest side, landscape or portrait", () => {
    expect(f.unitLabel).toBe("px short side");
    expect(run(f, { w: 1920, h: 1080 }, "lt", 1440)).toBe(true);
    expect(run(f, { w: 1920, h: 1080 }, "gt", 1080)).toBe(false);
    expect(run(f, { w: 1080, h: 1920 }, "gt", 1080)).toBe(false);
    expect(run(f, { w: 1080, h: 1920 }, "lt", 1440)).toBe(true);
    expect(run(f, { w: 1920, h: null }, "gt", 0)).toBe(false);
    expect(run(f, { w: null, h: 1080 }, "gt", 0)).toBe(false);
  });
});

describe("filenameField", () => {
  const t = (text: string, threshold?: number) => ({ text, threshold });
  const basic = filenameField<Row>((r) => r.name ?? "");
  const rich = filenameField<Row>((r) => r.name ?? "", {
    key: "name",
    label: "Name",
    operators: ["contains", "fuzzy_contains", "starts_with", "ends_with", "eq", "regex"],
    nfc: true,
  });
  const row = { name: "Holiday Clip.MP4" };

  it("defaults to Cleanup's filename field", () => {
    expect([basic.key, basic.label, basic.operators]).toEqual([
      "filename",
      "Filename",
      ["contains", "not_contains", "fuzzy_contains"],
    ]);
    expect([rich.key, rich.label]).toEqual(["name", "Name"]);
  });
  it("contains / not_contains are case-insensitive over a trimmed query", () => {
    expect(run(basic, row, "contains", t(" HOLIDAY "))).toBe(true);
    expect(run(basic, row, "not_contains", t("holiday"))).toBe(false);
    expect(run(basic, row, "contains", t("   "))).toBe(true); // empty query matches all
  });
  it("fuzzy_contains uses the bigram similarity threshold (default 40%)", () => {
    expect(run(basic, { name: "the office" }, "fuzzy_contains", t("ofice"))).toBe(true);
    expect(run(basic, { name: "the office" }, "fuzzy_contains", t("ofice", 95))).toBe(false);
  });
  it("starts_with / ends_with / eq", () => {
    expect(run(rich, row, "starts_with", t("holiday"))).toBe(true);
    expect(run(rich, row, "ends_with", t(".mp4"))).toBe(true);
    expect(run(rich, row, "eq", t("holiday clip.mp4"))).toBe(true);
    expect(run(rich, row, "eq", t("holiday"))).toBe(false);
  });
  it("regex is case-insensitive and an invalid pattern matches nothing", () => {
    expect(run(rich, row, "regex", t("^holiday\\s+clip"))).toBe(true);
    expect(() => run(rich, row, "regex", t("([unclosed"))).not.toThrow();
    expect(run(rich, row, "regex", t("([unclosed"))).toBe(false);
  });
  it("nfc matches decomposed names against composed queries", () => {
    const nfd = { name: "카리나 직캠.mp4".normalize("NFD") };
    expect(run(rich, nfd, "contains", t("카리나"))).toBe(true);
    expect(run(basic, nfd, "contains", t("카리나"))).toBe(false); // opt-in only
  });
});

describe("bigramSimilarity", () => {
  it("an empty needle matches anything (returns 1)", () => {
    expect(bigramSimilarity("anything", "")).toBe(1);
  });

  it("sub-2-char needle falls back to substring containment", () => {
    expect(bigramSimilarity("abc", "b")).toBe(1);
    expect(bigramSimilarity("abc", "z")).toBe(0);
  });

  it("identical strings score 1", () => {
    expect(bigramSimilarity("Breaking Bad", "breaking bad")).toBe(1);
  });

  it("no shared bigrams score 0", () => {
    expect(bigramSimilarity("abcd", "wxyz")).toBe(0);
  });

  it("partial overlap lands strictly between 0 and 1", () => {
    const score = bigramSimilarity("the office", "office");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});
