import { describe, it, expect } from "vitest";
import { exceedsCap, outputDims, speedLabel } from "./upscale";

describe("outputDims", () => {
  it("multiplies both sides", () => {
    expect(outputDims(1920, 1080, 4)).toEqual({ w: 7680, h: 4320 });
    expect(outputDims(1920, 1080, 1)).toEqual({ w: 1920, h: 1080 });
  });
  it("shrinks first (half-up per side), then multiplies by the model scale", () => {
    expect(outputDims(4000, 3000, 4, 4)).toEqual({ w: 4000, h: 3000 });
    expect(outputDims(801, 601, 2, 2)).toEqual({ w: 802, h: 602 });
    expect(outputDims(3, 2, 4, 4)).toEqual({ w: 4, h: 4 });
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
  it("uses the shrunk size when shrinking first", () => {
    expect(exceedsCap(4000, 3000, 4, 4)).toBe(false); // back to 12 MP
    expect(exceedsCap(9000, 6000, 4, 2)).toBe(true); // 216 MP
  });
  it("allows exactly 150 MP", () => {
    expect(exceedsCap(15000, 10000, 1)).toBe(false);
    expect(exceedsCap(15000, 10001, 1)).toBe(true);
  });
});
