import { describe, it, expect } from "vitest";
import { formatSize, formatDuration, formatBitrate } from "./format";

describe("formatSize", () => {
  it("returns '0 B' for 0, negatives and NaN", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(-5)).toBe("0 B");
    expect(formatSize(NaN)).toBe("0 B");
  });
  it("scales through the units", () => {
    expect(formatSize(512)).toBe("512.0 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1024 * 1024 * 3.5)).toBe("3.5 MB");
    expect(formatSize(1024 ** 4 * 2)).toBe("2.0 TB");
  });
  it("caps at TB for absurdly large values", () => {
    expect(formatSize(1024 ** 6)).toMatch(/TB$/);
  });
});

describe("formatDuration", () => {
  it("returns an em dash for null and 0", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("—");
  });
  it("formats sub-hour as M:SS and pads seconds", () => {
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(125)).toBe("2:05");
  });
  it("formats hour+ as H:MM:SS", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
  });
});

describe("formatBitrate", () => {
  it("returns '' for null / 0", () => {
    expect(formatBitrate(null)).toBe("");
    expect(formatBitrate(0)).toBe("");
  });
  it("uses bps / kbps / Mbps bands", () => {
    expect(formatBitrate(800)).toBe("800 bps");
    expect(formatBitrate(128_000)).toBe("128 kbps");
    expect(formatBitrate(5_000_000)).toBe("5.0 Mbps");
  });
});
