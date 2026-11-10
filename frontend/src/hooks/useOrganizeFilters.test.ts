// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";

const getOrganizeTags = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { getOrganizeTags: (p: string[], full?: boolean) => getOrganizeTags(p, full) },
}));

import { useOrganizeFilters } from "./useOrganizeFilters";

const file = (name: string): OrganizeFile => ({
  name,
  path: `/r/${name}`,
  kind: "audio",
  size: 1,
  mtime: 0,
});
const info = (title: string): OrganizeTagInfo => ({
  fields: { title },
  raw: { title },
  streams: [],
  truncated: false,
});

const files = [file("a"), file("b"), file("c")];
const details = { details: {}, loaded: 3, total: 3 };
const byName = { sortKey: "name" as const, sortDir: "asc" as const };

/** The tags the server "has": a and b are tagged, c has none. */
function serveTags() {
  getOrganizeTags.mockImplementation(async (paths: string[]) => ({
    tags: Object.fromEntries(
      paths.map((p) => [p, p === "/r/a" ? info("Zed") : p === "/r/b" ? info("Abe") : null]),
    ),
  }));
}

beforeEach(() => {
  getOrganizeTags.mockReset();
});
afterEach(cleanup);

describe("useOrganizeFilters with tags", () => {
  it("fetches tags only when columns want them or a tag clause exists", async () => {
    serveTags();
    const { result } = renderHook(() =>
      useOrganizeFilters(files, details, byName, { folderPath: "/r", wanted: false }),
    );
    expect(result.current.tagsWanted).toBe(false);
    act(() => void result.current.addClause("name"));
    await new Promise((r) => setTimeout(r, 20));
    expect(getOrganizeTags).not.toHaveBeenCalled();
    act(() => void result.current.addClause("tag_title"));
    expect(result.current.tagsWanted).toBe(true);
    await waitFor(() => expect(getOrganizeTags).toHaveBeenCalledTimes(1));
  });

  it("fetches tags for visible columns even without a tag clause", async () => {
    serveTags();
    renderHook(() =>
      useOrganizeFilters(files, details, byName, { folderPath: "/r", wanted: true }),
    );
    await waitFor(() => expect(getOrganizeTags).toHaveBeenCalledTimes(1));
  });

  it("filters by a loaded tag and keeps files whose tags are not loaded out", async () => {
    serveTags();
    const { result } = renderHook(() =>
      useOrganizeFilters(files, details, byName, { folderPath: "/r", wanted: false }),
    );
    let id: string | null = null;
    act(() => {
      id = result.current.addClause("tag_title");
    });
    act(() => result.current.updateClause(id!, { value: { text: "ze" } }));
    await waitFor(() => expect(result.current.visibleFiles.map((f) => f.name)).toEqual(["a"]));
  });

  it("counts the tags still loading while a tag clause waits on them", async () => {
    getOrganizeTags.mockImplementation(() => new Promise(() => {})); // never answers
    const { result } = renderHook(() =>
      useOrganizeFilters(files, details, byName, { folderPath: "/r", wanted: false }),
    );
    expect(result.current.stillLoading).toBe(0);
    act(() => void result.current.addClause("tag_title"));
    expect(result.current.stillLoading).toBe(3);
  });

  it("sorts by a tag key using the loaded tags, untagged files last", async () => {
    serveTags();
    const { result } = renderHook(() =>
      useOrganizeFilters(
        files,
        details,
        { sortKey: "tag_title", sortDir: "asc" },
        { folderPath: "/r", wanted: true },
      ),
    );
    await waitFor(() =>
      expect(result.current.sortedFiles.map((f) => f.name)).toEqual(["b", "a", "c"]),
    );
  });

  it("hands the loaded tags and their progress back for the columns and the panel", async () => {
    serveTags();
    const { result } = renderHook(() =>
      useOrganizeFilters(files, details, byName, { folderPath: "/r", wanted: true }),
    );
    await waitFor(() => expect(result.current.tagsProgress.done).toBe(true));
    expect(result.current.tagsProgress.tags["/r/a"]?.fields.title).toBe("Zed");
    expect(result.current.tagsProgress.tags["/r/c"]).toBeNull();
  });
});
