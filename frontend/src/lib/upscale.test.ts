import { describe, it, expect } from "vitest";
import {
  clampPrescale,
  exceedsCap,
  formatScale,
  outputDims,
  overallScale,
  speedLabel,
} from "./upscale";

describe("outputDims", () => {
  it("multiplies both sides", () => {
    expect(outputDims(1920, 1080, 4)).toEqual({ w: 7680, h: 4320 });
    expect(outputDims(1920, 1080, 1)).toEqual({ w: 1920, h: 1080 });
  });
  it("pre-scales by a percentage first (half-up per side), then multiplies by the model scale", () => {
    expect(outputDims(4000, 3000, 4, 25)).toEqual({ w: 4000, h: 3000 });
    expect(outputDims(801, 601, 2, 50)).toEqual({ w: 802, h: 602 });
    expect(outputDims(3, 2, 4, 10)).toEqual({ w: 4, h: 4 });
  });
  it("accepts any percentage, not just fractions like 1/2 or 1/4", () => {
    // 75% of 1310x1756 = 982.5 -> 983, 1317 -> then the 4x model (mirrors the backend test)
    expect(outputDims(1310, 1756, 4, 75)).toEqual({ w: 3932, h: 5268 });
    expect(outputDims(1000, 500, 4, 33)).toEqual({ w: 1320, h: 660 });
  });
  it("treats 100 as off", () => {
    expect(outputDims(800, 600, 2, 100)).toEqual({ w: 1600, h: 1200 });
  });
});

describe("clampPrescale", () => {
  it("keeps whole percentages from 10 to 100", () => {
    expect(clampPrescale(75)).toBe(75);
    expect(clampPrescale(10)).toBe(10);
    expect(clampPrescale(100)).toBe(100);
  });
  it("clamps and rounds", () => {
    expect(clampPrescale(3)).toBe(10);
    expect(clampPrescale(0)).toBe(10);
    expect(clampPrescale(250)).toBe(100);
    expect(clampPrescale(62.6)).toBe(63);
  });
  it("falls back to 100 for something that isn't a number", () => {
    expect(clampPrescale(Number.NaN)).toBe(100);
  });
});

describe("overallScale / formatScale", () => {
  it("is the model's scale times the percentage", () => {
    expect(overallScale(4, 25)).toBe(1);
    expect(overallScale(4, 50)).toBe(2);
    expect(overallScale(4, 75)).toBe(3);
    expect(overallScale(2, 100)).toBe(2);
  });
  it("prints whole numbers plainly and others with one decimal", () => {
    expect(formatScale(3)).toBe("3×");
    expect(formatScale(1.32)).toBe("1.3×");
    expect(formatScale(2.5)).toBe("2.5×");
  });
});

describe("speedLabel", () => {
  it("maps speeds to labels", () => {
    expect(speedLabel("fast")).toBe("Fast");
    expect(speedLabel("slow")).toBe("Slow");
  });
});

describe("exceedsCap", () => {
  it("flags outputs over 150 MP", () => {
    expect(exceedsCap(4000, 3000, 4)).toBe(true); // 192 MP
    expect(exceedsCap(4000, 3000, 2)).toBe(false); // 48 MP
  });
  it("uses the pre-scaled size", () => {
    expect(exceedsCap(4000, 3000, 4, 25)).toBe(false); // back to 12 MP
    expect(exceedsCap(9000, 6000, 4, 50)).toBe(true); // 216 MP
  });
  it("allows exactly 150 MP", () => {
    expect(exceedsCap(15000, 10000, 1)).toBe(false);
    expect(exceedsCap(15000, 10001, 1)).toBe(true);
  });
});
