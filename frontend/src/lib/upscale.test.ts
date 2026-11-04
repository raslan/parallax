import { describe, it, expect } from "vitest";
import { clampScale, exceedsCap, outputDims, speedLabel } from "./upscale";
import type { UpscaleTier } from "@/types/upscale";

const simple: UpscaleTier = {
  id: "simple",
  label: "Simple",
  scale: 2,
  speed: "fast",
  hint: "",
  scales: [1, 2],
};
const best: UpscaleTier = {
  id: "best",
  label: "Best",
  scale: 4,
  speed: "slow",
  hint: "",
  scales: [1, 2, 4],
};

describe("clampScale", () => {
  it("keeps an available scale", () => {
    expect(clampScale(best, 4)).toBe(4);
    expect(clampScale(simple, 2)).toBe(2);
    expect(clampScale(best, 1)).toBe(1);
  });
  it("drops to the largest available scale below the request", () => {
    expect(clampScale(simple, 4)).toBe(2);
  });
  it("falls back to the smallest available when none is below", () => {
    expect(clampScale({ ...simple, scales: [2] }, 1)).toBe(2);
  });
});

describe("outputDims", () => {
  it("multiplies both sides", () => {
    expect(outputDims(1920, 1080, 4)).toEqual({ w: 7680, h: 4320 });
    expect(outputDims(1920, 1080, 1)).toEqual({ w: 1920, h: 1080 });
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
  it("allows exactly 150 MP", () => {
    expect(exceedsCap(15000, 10000, 1)).toBe(false);
    expect(exceedsCap(15000, 10001, 1)).toBe(true);
  });
});
