// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TAG_COLUMNS_KEY } from "@/lib/organizeTags";
import { useTagColumns } from "./useTagColumns";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("useTagColumns", () => {
  it("starts with no columns when nothing is saved", () => {
    const { result } = renderHook(() => useTagColumns());
    expect(result.current[0]).toEqual([]);
  });

  it("starts from the saved list", () => {
    localStorage.setItem(TAG_COLUMNS_KEY, '["genre"]');
    const { result } = renderHook(() => useTagColumns());
    expect(result.current[0]).toEqual(["genre"]);
  });

  it("remembers a change", () => {
    const { result } = renderHook(() => useTagColumns());
    act(() => result.current[1](["artist", "date"]));
    expect(result.current[0]).toEqual(["artist", "date"]);
    expect(localStorage.getItem(TAG_COLUMNS_KEY)).toBe('["artist","date"]');
  });
});
