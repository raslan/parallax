import { describe, expect, it } from "vitest";
import {
  areaPaths,
  cumulativeSaved,
  deltaPct,
  formatDurationWords,
  heatmapCells,
  isRangeKey,
  rangeOf,
  savedShare,
  splitSize,
} from "./dashboard";
import type { StatsPoint } from "@/types/stats";

const pt = (t: string, jobs = 1, bytes_saved = 0): StatsPoint => ({
  t,
  jobs,
  files: jobs,
  bytes_saved,
});

describe("ranges", () => {
  it("knows its keys and falls back to 30 days", () => {
    expect(isRangeKey("90")).toBe(true);
    expect(isRangeKey("12")).toBe(false);
    expect(rangeOf("all").days).toBe(0);
  });
});

describe("deltaPct", () => {
  it("is null without a baseline", () => {
    expect(deltaPct(100, 0)).toBeNull();
  });
  it("rounds the percentage change", () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
  });
});

describe("cumulativeSaved", () => {
  it("keeps a running total and never dips below zero", () => {
    expect(cumulativeSaved([pt("a", 1, 100), pt("b", 1, -300), pt("c", 1, 50)])).toEqual([
      100, 0, 50,
    ]);
  });
});

describe("areaPaths", () => {
  it("returns nothing for no data", () => {
    expect(areaPaths([], 100, 40)).toEqual({ line: "", area: "", points: [] });
  });
  it("scales the largest value to the top padding and closes the area", () => {
    const { line, area, points } = areaPaths([0, 10], 100, 44, 4);
    expect(points[0]).toEqual({ x: 0, y: 40 });
    expect(points[1]).toEqual({ x: 100, y: 4 });
    expect(line.startsWith("M0.0,40.0")).toBe(true);
    expect(area.endsWith("Z")).toBe(true);
  });
  it("centres a single point instead of dividing by zero", () => {
    expect(areaPaths([5], 100, 40).points[0]?.x).toBe(50);
  });
});

describe("heatmapCells", () => {
  const end = new Date(2026, 5, 17); // Wednesday
  it("ends on the end date and counts jobs per day", () => {
    const cells = heatmapCells([pt("2026-06-17", 3), pt("2026-06-16", 1)], 4, end);
    const last = cells[cells.length - 1]!;
    expect(last.date).toBe("2026-06-17");
    expect(last.jobs).toBe(3);
    expect(last.level).toBe(4);
    expect(last.row).toBe(2); // Monday-first: Wed = 2
    expect(cells.find((c) => c.date === "2026-06-16")?.level).toBe(2);
  });
  it("lays out whole weeks in columns and stops at the end date", () => {
    const cells = heatmapCells([], 3, end);
    expect(cells[0]?.row).toBe(0);
    expect(cells[cells.length - 1]?.col).toBe(2);
    expect(cells.every((c) => c.level === 0)).toBe(true);
  });
});

describe("display helpers", () => {
  it("splits a size into value and unit", () => {
    expect(splitSize(1.5 * 1024 ** 3)).toEqual({ value: "1.5", unit: "GB" });
    expect(splitSize(-5)).toEqual({ value: "0", unit: "B" });
  });
  it("describes durations in words", () => {
    expect(formatDurationWords(20)).toBe("under a minute");
    expect(formatDurationWords(45 * 60)).toBe("45 min");
    expect(formatDurationWords(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(formatDurationWords(2 * 3600)).toBe("2 h");
  });
  it("computes the saved share, clamped", () => {
    expect(savedShare(1000, 600)).toBeCloseTo(0.4);
    expect(savedShare(100, 150)).toBe(0);
    expect(savedShare(0, 0)).toBe(0);
  });
});
