// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OrganizeFile, OrganizeTagInfo } from "@/types/organize";
import { useOrganizeFilters } from "./useOrganizeFilters";

afterEach(cleanup);

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
const sort = { sortKey: "name" as const, sortDir: "asc" as const };

function setup(tags: {
  tags: Record<string, OrganizeTagInfo | null>;
  loaded: number;
  total: number;
}) {
  return renderHook(() => useOrganizeFilters(files, details, sort, tags));
}

describe("useOrganizeFilters with tags", () => {
  it("wants tags only once a tag clause exists", () => {
    const { result } = setup({ tags: {}, loaded: 0, total: 3 });
    expect(result.current.tagsWanted).toBe(false);
    act(() => void result.current.addClause("name"));
    expect(result.current.tagsWanted).toBe(false);
    act(() => void result.current.addClause("tag_title"));
    expect(result.current.tagsWanted).toBe(true);
  });

  it("filters by a loaded tag and keeps unloaded files out", () => {
    const { result } = setup({
      tags: { "/r/a": info("Xylophone"), "/r/b": info("Yacht") },
      loaded: 2,
      total: 3,
    });
    let id: string | null = null;
    act(() => {
      id = result.current.addClause("tag_title");
    });
    act(() => result.current.updateClause(id!, { value: { text: "xyl" } }));
    expect(result.current.visibleFiles.map((f) => f.name)).toEqual(["a"]);
  });

  it("counts the tags still loading while a tag clause waits on them", () => {
    const { result } = setup({ tags: {}, loaded: 1, total: 3 });
    expect(result.current.stillLoading).toBe(0);
    act(() => void result.current.addClause("tag_title"));
    expect(result.current.stillLoading).toBe(2);
  });

  it("sorts by a tag key using the loaded tags", () => {
    const { result } = renderHook(() =>
      useOrganizeFilters(
        files,
        details,
        { sortKey: "tag_title", sortDir: "asc" },
        { tags: { "/r/a": info("Zed"), "/r/b": info("Abe") }, loaded: 2, total: 3 },
      ),
    );
    expect(result.current.sortedFiles.map((f) => f.name)).toEqual(["b", "a", "c"]);
  });
});
