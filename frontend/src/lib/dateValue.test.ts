import { describe, expect, it } from "vitest";
import { dateCutoffSeconds, formatDateValue, parseIsoDate, toIsoDate } from "./dateValue";

describe("dateCutoffSeconds", () => {
  it("subtracts a relative age from now", () => {
    expect(dateCutoffSeconds({ n: 2, unit: "days" }, 1_000_000)).toBe(1_000_000 - 2 * 86400);
    expect(dateCutoffSeconds({ n: 1, unit: "weeks" }, 1_000_000)).toBe(1_000_000 - 604800);
  });

  it("falls back to days for an unknown unit", () => {
    expect(dateCutoffSeconds({ n: 1, unit: "eons" }, 100_000)).toBe(100_000 - 86400);
  });

  it("uses local midnight of an absolute date", () => {
    expect(dateCutoffSeconds({ date: "2024-05-01" })).toBe(new Date(2024, 4, 1).getTime() / 1000);
  });
});

describe("iso date helpers", () => {
  it("round-trips a date", () => {
    expect(toIsoDate(parseIsoDate("2024-05-01"))).toBe("2024-05-01");
  });
  it("formats both shapes for the filter chip", () => {
    expect(formatDateValue({ n: 30, unit: "days" })).toBe("30 days");
    expect(formatDateValue({ date: "2024-05-01" })).toBe("2024-05-01");
  });
});
