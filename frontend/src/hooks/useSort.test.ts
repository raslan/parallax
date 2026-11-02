// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSort } from "./useSort";

type K = "name" | "size" | "files";

describe("useSort", () => {
  it("starts ascending, flips on the same key and resets to ascending on a new one", () => {
    const { result } = renderHook(() => useSort<K>("name"));
    expect([result.current.sortKey, result.current.sortDir]).toEqual(["name", "asc"]);
    act(() => result.current.toggleSort("name"));
    expect(result.current.sortDir).toBe("desc");
    act(() => result.current.toggleSort("size"));
    expect([result.current.sortKey, result.current.sortDir]).toEqual(["size", "asc"]);
    act(() => result.current.toggleSort("size"));
    expect(result.current.sortDir).toBe("desc");
  });

  it("uses a per-key default direction when given one", () => {
    const defaultDir = (k: K) => (k === "name" ? "asc" : "desc");
    const { result } = renderHook(() => useSort<K>("files", defaultDir));
    expect([result.current.sortKey, result.current.sortDir]).toEqual(["files", "desc"]);
    act(() => result.current.toggleSort("name"));
    expect([result.current.sortKey, result.current.sortDir]).toEqual(["name", "asc"]);
    act(() => result.current.toggleSort("size"));
    expect([result.current.sortKey, result.current.sortDir]).toEqual(["size", "desc"]);
    act(() => result.current.toggleSort("size"));
    expect(result.current.sortDir).toBe("asc");
  });

  it("flips exactly once per toggle under StrictMode double-invoked updaters", () => {
    const { result } = renderHook(() => useSort<K>("name"), { reactStrictMode: true });
    act(() => result.current.toggleSort("name"));
    expect(result.current.sortDir).toBe("desc");
  });
});
