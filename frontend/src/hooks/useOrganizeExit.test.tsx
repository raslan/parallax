// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { qk } from "@/lib/api";
import { EXIT_MS, useOrganizeExit } from "./useOrganizeExit";

function setup() {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { invalidate, ...renderHook(() => useOrganizeExit(), { wrapper }) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useOrganizeExit", () => {
  it("refreshListings waits for the delay, then invalidates both listings and clears the leaving sets", () => {
    const { result, invalidate } = setup();
    act(() => {
      result.current.leaveFiles(["/a/x"]);
      result.current.leaveFolders(["/a/f"]);
      result.current.refreshListings(EXIT_MS);
    });
    expect(result.current.leavingFiles).toEqual(new Set(["/a/x"]));
    act(() => void vi.advanceTimersByTime(EXIT_MS - 1));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.organizeFolder() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.organizeFiles() });
    expect(result.current.leavingFiles.size).toBe(0);
    expect(result.current.leavingFolders.size).toBe(0);
  });

  it("leaveFolders replaces the set, or adds to it when additive", () => {
    const { result } = setup();
    act(() => result.current.leaveFolders(["a"]));
    act(() => result.current.leaveFolders(["b"], true));
    expect(result.current.leavingFolders).toEqual(new Set(["a", "b"]));
    act(() => result.current.leaveFolders(["c"]));
    expect(result.current.leavingFolders).toEqual(new Set(["c"]));
  });

  it("a pending refresh is dropped on unmount", () => {
    const { result, invalidate, unmount } = setup();
    act(() => result.current.refreshListings(EXIT_MS));
    unmount();
    act(() => void vi.advanceTimersByTime(EXIT_MS * 2));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
