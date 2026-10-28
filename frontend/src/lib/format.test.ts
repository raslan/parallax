import { describe, it, expect } from "vitest";
import {
  formatSize,
  formatDuration,
  formatBitrate,
  formatRelative,
  describeSelection,
  sumSizeOf,
} from "./format";

describe("describeSelection", () => {
  it("pluralises and appends the size when known", () => {
    expect(describeSelection(1, "file")).toBe("1 file");
    expect(describeSelection(14, "file", 8.2 * 1024 ** 3)).toBe("14 files (8.2 GB)");
  });
  it("omits an unknown or zero size", () => {
    expect(describeSelection(3, "image", 0)).toBe("3 images");
  });
});

describe("sumSizeOf", () => {
  it("adds up only the selected items", () => {
    const items = [
      { id: 1, size: 10 },
      { id: 2, size: 20 },
      { id: 3, size: 40 },
    ];
    expect(sumSizeOf(items, new Set([1, 3]))).toBe(50);
    expect(sumSizeOf(items, new Set())).toBe(0);
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it("says just now for the last few seconds", () => {
    expect(formatRelative(ago(5), now)).toBe("now");
  });
  it("steps through minutes, hours, days, months and years", () => {
    expect(formatRelative(ago(5 * 60), now)).toBe("5 minutes ago");
    expect(formatRelative(ago(3 * 3600), now)).toBe("3 hours ago");
    expect(formatRelative(ago(2 * 86400), now)).toBe("2 days ago");
    expect(formatRelative(ago(90 * 86400), now)).toBe("3 months ago");
    expect(formatRelative(ago(800 * 86400), now)).toBe("2 years ago");
  });
  it("handles the future", () => {
    expect(formatRelative(new Date(now.getTime() + 2 * 3600 * 1000), now)).toBe("in 2 hours");
  });
});

describe("formatSize", () => {
  it("returns '0 B' for a real zero", () => {
    expect(formatSize(0)).toBe("0 B");
  });
  it("returns an em dash for missing or invalid sizes", () => {
    expect(formatSize(null)).toBe("—");
    expect(formatSize(undefined)).toBe("—");
    expect(formatSize(-5)).toBe("—");
    expect(formatSize(NaN)).toBe("—");
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
  it("returns an em dash for null / 0", () => {
    expect(formatBitrate(null)).toBe("—");
    expect(formatBitrate(0)).toBe("—");
  });
  it("uses bps / kbps / Mbps bands", () => {
    expect(formatBitrate(800)).toBe("800 bps");
    expect(formatBitrate(128_000)).toBe("128 kbps");
    expect(formatBitrate(5_000_000)).toBe("5.0 Mbps");
  });
});
