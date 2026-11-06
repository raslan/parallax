// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyOverrides, seedFromGroups, useSeededSelection } from "./useSeededSelection";

afterEach(cleanup);

const s = (...ids: number[]) => new Set(ids);

describe("seedFromGroups", () => {
  it("seeds every copy except the keeper", () => {
    const { seed, visible } = seedFromGroups([
      { files: [{ id: 1 }, { id: 2 }, { id: 3 }], keep_id: 2 },
    ]);
    expect(seed).toEqual(s(1, 3));
    expect(visible).toEqual(s(1, 2, 3));
  });

  it("seeds each group independently", () => {
    const { seed, visible } = seedFromGroups([
      { files: [{ id: 1 }, { id: 2 }], keep_id: 1 },
      { files: [{ id: 3 }, { id: 4 }], keep_id: 4 },
    ]);
    expect(seed).toEqual(s(2, 3));
    expect(visible).toEqual(s(1, 2, 3, 4));
  });
});

describe("applyOverrides", () => {
  it("follows the seed when nothing was changed by hand", () => {
    expect(applyOverrides(s(1, 3), s(1, 2, 3), new Map())).toEqual(s(1, 3));
  });

  it("lets a hand-made choice beat the seed in both directions", () => {
    const overrides = new Map([
      [1, false],
      [2, true],
    ]);
    expect(applyOverrides(s(1, 3), s(1, 2, 3), overrides)).toEqual(s(2, 3));
  });

  it("never ticks a copy that is not on screen", () => {
    expect(applyOverrides(s(1, 9), s(1, 2), new Map([[7, true]]))).toEqual(s(1));
  });
});

describe("useSeededSelection", () => {
  it("starts from the seed", () => {
    const { result } = renderHook(() => useSeededSelection(s(1, 3), s(1, 2, 3)));
    expect(result.current.selected).toEqual(s(1, 3));
  });

  it("toggle flips a copy in either direction", () => {
    const { result } = renderHook(() => useSeededSelection(s(1, 3), s(1, 2, 3)));
    act(() => result.current.toggle(1));
    expect(result.current.selected).toEqual(s(3));
    act(() => result.current.toggle(2));
    expect(result.current.selected).toEqual(s(2, 3));
  });

  it("keeps an untick when the group recomputes", () => {
    let seed = s(1, 3);
    let visible = s(1, 2, 3);
    const { result, rerender } = renderHook(() => useSeededSelection(seed, visible));
    act(() => result.current.toggle(3)); // keep copy 3
    seed = s(1, 3, 4);
    visible = s(1, 2, 3, 4);
    rerender();
    expect(result.current.selected).toEqual(s(1, 4));
  });

  it("remembers an untick across a copy leaving every group and coming back", () => {
    let seed = s(1, 3);
    let visible = s(1, 2, 3);
    const { result, rerender } = renderHook(() => useSeededSelection(seed, visible));
    act(() => result.current.toggle(3));
    seed = s(1);
    visible = s(1, 2); // 3 dropped out (e.g. a chip was added)
    rerender();
    expect(result.current.selected).toEqual(s(1));
    seed = s(1, 3);
    visible = s(1, 2, 3); // chip removed again
    rerender();
    expect(result.current.selected).toEqual(s(1));
  });

  it("remembers an untick when the keeper flips and flips back", () => {
    // Group {1,2,3}: keeper 2, so 1 and 3 are ticked. Unticking 3 keeps it.
    let seed = s(1, 3);
    const visible = s(1, 2, 3);
    const { result, rerender } = renderHook(() => useSeededSelection(seed, visible));
    act(() => result.current.toggle(3));
    seed = s(1, 2); // keeper flips to 3: the seed no longer ticks it
    rerender();
    expect(result.current.selected).toEqual(s(1, 2));
    seed = s(1, 3); // flips back
    rerender();
    expect(result.current.selected).toEqual(s(1));
  });

  it("clear unticks everything on screen and sticks", () => {
    let seed = s(1, 3);
    const visible = s(1, 2, 3);
    const { result, rerender } = renderHook(() => useSeededSelection(seed, visible));
    act(() => result.current.clear());
    expect(result.current.selected).toEqual(s());
    seed = s(1, 2, 3);
    rerender();
    expect(result.current.selected).toEqual(s());
  });

  it("reset forgets hand-made choices", () => {
    const { result } = renderHook(() => useSeededSelection(s(1, 3), s(1, 2, 3)));
    act(() => result.current.clear());
    act(() => result.current.reset());
    expect(result.current.selected).toEqual(s(1, 3));
  });

  it("is empty while nothing is on screen", () => {
    const { result } = renderHook(() => useSeededSelection(s(), s()));
    expect(result.current.selected).toEqual(s());
  });
});
