import { describe, expect, it } from "vitest";
import {
  MAX_STRETCH_SECONDS,
  SIMILARITY_MIN_PCT,
  clampSimilarityPct,
  parseStretchSeconds,
  splitBySharedAudio,
} from "./sharedAudio";

const f = (id: number, shared: [number, number][] | string | null) => ({
  id,
  shared_audio: typeof shared === "string" || shared === null ? shared : JSON.stringify(shared),
});
const ids = (groups: { id: number }[][]) => groups.map((g) => g.map((x) => x.id));

describe("clampSimilarityPct", () => {
  it("holds the value inside the range the server accepts", () => {
    expect(SIMILARITY_MIN_PCT).toBe(65);
    expect(clampSimilarityPct(20)).toBe(65);
    expect(clampSimilarityPct(75)).toBe(75);
    expect(clampSimilarityPct(100)).toBe(95);
  });
});

describe("parseStretchSeconds", () => {
  it("reads whole and fractional seconds", () => {
    expect(parseStretchSeconds("10")).toBe(10);
    expect(parseStretchSeconds("2.5")).toBe(2.5);
    expect(parseStretchSeconds("0")).toBe(0);
  });

  it("holds the value inside 0 to the server's maximum", () => {
    expect(parseStretchSeconds("4000")).toBe(MAX_STRETCH_SECONDS);
    expect(parseStretchSeconds("-5")).toBe(0);
  });

  it("is null while the text is not a number yet, so an empty field is not 0", () => {
    expect(parseStretchSeconds("")).toBeNull();
    expect(parseStretchSeconds("   ")).toBeNull();
    expect(parseStretchSeconds("abc")).toBeNull();
    expect(parseStretchSeconds("Infinity")).toBeNull();
  });
});

describe("splitBySharedAudio", () => {
  it("groups files joined by a link at or above the threshold, as chains", () => {
    // 2 and 3 are both inside 1 but share nothing with each other.
    const group = [
      f(1, [
        [2, 1],
        [3, 0.9],
      ]),
      f(2, [[1, 1]]),
      f(3, [[1, 0.9]]),
      f(4, null),
    ];
    expect(ids(splitBySharedAudio([group], 0.8))).toEqual([[1, 2, 3]]);
  });

  it("leaves out a link below the threshold", () => {
    const group = [f(1, [[2, 0.5]]), f(2, [[1, 0.5]])];
    expect(splitBySharedAudio([group], 0.8)).toEqual([]);
    expect(ids(splitBySharedAudio([group], 0.5))).toEqual([[1, 2]]);
  });

  it("ignores links to files outside the group, such as a deleted file", () => {
    const group = [f(1, [[99, 1]]), f(2, null)];
    expect(splitBySharedAudio([group], 0.5)).toEqual([]);
  });

  it("keeps each group separate and the files in their original order", () => {
    const g1 = [f(5, [[3, 1]]), f(3, [[5, 1]])];
    const g2 = [f(8, [[7, 1]]), f(7, [[8, 1]])];
    expect(ids(splitBySharedAudio([g1, g2], 0.5))).toEqual([
      [5, 3],
      [8, 7],
    ]);
  });

  it("does not link files in different groups, even if the stored values say so", () => {
    const g1 = [f(1, [[2, 1]])];
    const g2 = [f(2, [[1, 1]])];
    expect(splitBySharedAudio([g1, g2], 0.5)).toEqual([]);
  });

  it("ignores missing, malformed and wrong-shaped values", () => {
    const group = [
      f(1, "not json"),
      f(2, "{}"),
      f(3, '[["x", 1], [1], null, [2, "high"]]'),
      f(4, null),
    ];
    expect(splitBySharedAudio([group], 0)).toEqual([]);
  });
});
