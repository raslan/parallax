import { describe, expect, it } from "vitest";
import { itemsInRect, rectBetween, type GridGeometry } from "./marquee";

// 3 columns of 100x50 cells, 10px gaps, 7 items -> rows of 3, 3, 1.
const grid: GridGeometry = {
  count: 7,
  columns: 3,
  colWidth: 100,
  colGap: 10,
  rowHeight: 50,
  rowGap: 10,
};

describe("rectBetween", () => {
  it("normalises any drag direction", () => {
    expect(rectBetween(30, 40, 10, 5)).toEqual({ left: 10, top: 5, right: 30, bottom: 40 });
  });
});

describe("itemsInRect", () => {
  it("selects the cells a box touches", () => {
    expect(itemsInRect(grid, rectBetween(50, 20, 150, 80))).toEqual([0, 1, 3, 4]);
  });

  it("ignores gaps between cells", () => {
    expect(itemsInRect(grid, rectBetween(102, 5, 108, 45))).toEqual([]);
  });

  it("clips to the item count", () => {
    expect(itemsInRect(grid, rectBetween(0, 0, 400, 400))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("works for a single-column list", () => {
    const list: GridGeometry = { ...grid, columns: 1, colWidth: 300, colGap: 0, rowGap: 0 };
    expect(itemsInRect(list, rectBetween(10, 60, 20, 130))).toEqual([1, 2]);
  });

  it("returns nothing for an empty or unmeasured grid", () => {
    expect(itemsInRect({ ...grid, count: 0 }, rectBetween(0, 0, 50, 50))).toEqual([]);
    expect(itemsInRect({ ...grid, colWidth: 0 }, rectBetween(0, 0, 50, 50))).toEqual([]);
  });
});
