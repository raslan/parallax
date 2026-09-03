import { describe, it, expect } from "vitest";
import { bigramSimilarity } from "./cleanupFields";

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
