import { describe, it, expect } from "vitest";
import {
  invertSelection,
  reconcileSelection,
  removeDeleted,
  sameSet,
  selectedIn,
} from "@/lib/organizeSelect";
import { evaluateClauses, type Clause } from "@/hooks/useQueryBuilder";
import { organizeFields } from "@/lib/organizeSearch";
import type { OrganizeFile } from "@/types/organize";

const f = (name: string, size: number, kind: OrganizeFile["kind"] = "video"): OrganizeFile => ({
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

describe("selectedIn", () => {
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

  it("drops picks hidden by a filter even while details are still streaming", () => {
    // Repro: select all while details stream, then add `name contains foo` AND
    // `duration > 60`. B fails the name clause and has no details yet.
    const a = { ...f("foo-a.mp4", 1), details: undefined };
    const b = { ...f("bar-b.mp4", 1), details: undefined };
    const all = [a, b];
    const byKey = Object.fromEntries(organizeFields.map((x) => [x.key, x]));
    const clauses: Clause[] = [
      {
        id: "1",
        fieldKey: "name",
        operator: "contains",
        value: { text: "foo" },
        joinToNext: "AND",
      },
      { id: "2", fieldKey: "duration", operator: "gt", value: 60, joinToNext: "AND" },
    ];
    const visible = all.filter((r) => evaluateClauses(clauses, r, byKey, {}));
    let stored: Set<string> = new Set(all.map((x) => x.path));
    stored =
      reconcileSelection(stored, new Set(selectedIn(visible, stored).map((x) => x.path))) ?? stored;
    expect(stored.has(b.path)).toBe(false);
    // Removing the clauses must not bring B back.
    expect(selectedIn(all, stored).map((x) => x.path)).not.toContain(b.path);
  });
});

describe("sameSet", () => {
  it("compares sets by content", () => {
    expect(sameSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });
});
