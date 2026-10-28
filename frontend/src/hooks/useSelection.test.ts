import { describe, expect, it } from "vitest";
import { rangeBetween } from "./useSelection";

describe("rangeBetween", () => {
  const order = [10, 20, 30, 40, 50];

  it("returns the inclusive slice in either direction", () => {
    expect(rangeBetween(order, 20, 40)).toEqual([20, 30, 40]);
    expect(rangeBetween(order, 40, 20)).toEqual([20, 30, 40]);
  });

  it("returns just the one id when both ends match", () => {
    expect(rangeBetween(order, 30, 30)).toEqual([30]);
  });

  it("returns nothing when an end is no longer in the list", () => {
    expect(rangeBetween(order, 20, 99)).toEqual([]);
    expect(rangeBetween(order, 99, 20)).toEqual([]);
  });
});
