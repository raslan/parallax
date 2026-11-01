import { describe, it, expect } from "vitest";
import {
  invertSelection,
  parentPath,
  reconcileSelection,
  removeDeleted,
  sameSet,
  selectedIn,
  sumBytes,
} from "@/lib/pruneSelect";
import type { PruneFile } from "@/types/prune";

const f = (name: string, size: number, kind: PruneFile["kind"] = "video"): PruneFile => ({
  name,
  path: `/r/${name}`,
  kind,
  size,
  mtime: 0,
});

describe("invertSelection", () => {
  it("returns the visible paths that are not selected", () => {
    const visible = ["/r/a", "/r/b", "/r/c"];
    expect(invertSelection(visible, new Set(["/r/b"]))).toEqual(["/r/a", "/r/c"]);
  });

  it("drops selected paths that are not visible", () => {
    expect(invertSelection(["/r/a"], new Set(["/r/hidden"]))).toEqual(["/r/a"]);
  });
});

describe("removeDeleted", () => {
  it("removes deleted paths and keeps failed ones selected", () => {
    const sel = new Set(["/r/a", "/r/b", "/r/c"]);
    const next = removeDeleted(sel, ["/r/a", "/r/c"]);
    expect([...next]).toEqual(["/r/b"]);
  });
});

describe("selectedIn / parentPath", () => {
  it("prunes the selection against the live list, in list order", () => {
    const live = [f("b", 1), f("a", 1)];
    const sel = new Set(["/r/a", "/r/gone", "/r/b"]);
    expect(selectedIn(live, sel).map((x) => x.name)).toEqual(["b", "a"]);
  });

  it("restricts to visible files when given the filtered list", () => {
    const visible = [f("a", 1)];
    const sel = new Set(["/r/a", "/r/hidden"]);
    expect(selectedIn(visible, sel).map((x) => x.path)).toEqual(["/r/a"]);
  });

  it("returns the parent of a path", () => {
    expect(parentPath("/r/a/b")).toBe("/r/a");
    expect(parentPath("/r")).toBe("/");
  });
});

describe("reconcileSelection", () => {
  it("filtering shrinks the stored selection and un-filtering does not bring it back", () => {
    const all = [f("a", 1), f("b", 1), f("c", 1)];
    let stored = new Set(all.map((x) => x.path));
    // filter shows only "a"
    const visible = selectedIn([all[0]!], stored);
    const shrunk = reconcileSelection(stored, new Set(visible.map((x) => x.path)));
    expect(shrunk && [...shrunk]).toEqual(["/r/a"]);
    stored = shrunk!;
    // filter removed: everything visible again, selection stays {a}
    const again = selectedIn(all, stored);
    expect(reconcileSelection(stored, new Set(again.map((x) => x.path)))).toBeNull();
    expect(again.map((x) => x.name)).toEqual(["a"]);
  });

  it("keeps picks whose details are still loading, drops the rest", () => {
    const stored = new Set(["/r/a", "/r/b", "/r/c"]);
    const allowed = new Set(["/r/a"]); // only a matches so far
    const pending = new Set(["/r/b"]); // b's details have not arrived yet
    expect([...reconcileSelection(stored, allowed, pending)!]).toEqual(["/r/a", "/r/b"]);
    expect(reconcileSelection(new Set(["/r/a", "/r/b"]), allowed, pending)).toBeNull();
    expect([...reconcileSelection(stored, allowed, new Set())!]).toEqual(["/r/a"]);
  });
});

describe("sumBytes / sameSet", () => {
  it("sums only selected files", () => {
    const files = [f("a", 10), f("b", 20), f("c", 30)];
    expect(sumBytes(files, new Set(["/r/a", "/r/c"]))).toBe(40);
  });

  it("compares sets by content", () => {
    expect(sameSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });
});
