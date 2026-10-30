import { describe, it, expect } from "vitest";
import { estimateAudioSize, audioSavingsPct, isAlreadyAtTarget } from "./audioCompress";

describe("estimateAudioSize", () => {
  it("scales linearly with bitrate", () => {
    expect(estimateAudioSize(300, 256)).toBeCloseTo(estimateAudioSize(300, 128) * 2, -2);
  });
  it("is zero for missing duration", () => {
    expect(estimateAudioSize(null, 128)).toBe(0);
    expect(estimateAudioSize(0, 128)).toBe(0);
  });
  it("is bitrate*duration plus a small overhead", () => {
    const est = estimateAudioSize(600, 128); // 9_600_000 pre-overhead
    expect(est).toBeGreaterThanOrEqual(9_600_000);
    expect(est).toBeLessThanOrEqual(9_600_000 * 1.05);
  });
});

describe("isAlreadyAtTarget", () => {
  it("treats a same-codec file within the VBR headroom as done", () => {
    expect(isAlreadyAtTarget("opus", 134_000, "opus", 128)).toBe(true);
    expect(isAlreadyAtTarget("opus", 128_000, "opus", 128)).toBe(true);
    expect(isAlreadyAtTarget("opus", 175_000, "opus", 128)).toBe(false);
  });
  it("is strict across codecs", () => {
    expect(isAlreadyAtTarget("mp3", 134_000, "opus", 128)).toBe(false);
    expect(isAlreadyAtTarget("mp3", 128_000, "opus", 128)).toBe(true);
  });
  it("never skips a file with an unknown bitrate", () => {
    expect(isAlreadyAtTarget("opus", null, "opus", 128)).toBe(false);
    expect(isAlreadyAtTarget("opus", 0, "opus", 128)).toBe(false);
  });
});

describe("audioSavingsPct", () => {
  it("never goes negative", () => {
    expect(audioSavingsPct(1000, 1500)).toBe(0);
  });
  it("computes a positive saving", () => {
    expect(audioSavingsPct(1000, 500)).toBe(50);
  });
  it("is zero when source is zero", () => {
    expect(audioSavingsPct(0, 500)).toBe(0);
  });
});
