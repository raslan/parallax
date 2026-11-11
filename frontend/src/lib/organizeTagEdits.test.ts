import { describe, expect, it } from "vitest";
import {
  buildReview,
  chunkApplyItems,
  currentValue,
  effectiveValue,
  stageOp,
  standardFieldFor,
  fieldLabel,
  toApplyItems,
  unstageField,
  type StageFile,
} from "./organizeTagEdits";
import type { OrganizeTagInfo, TagPlan } from "@/types/organize";

const info = (
  fields: Record<string, string>,
  extra: Partial<OrganizeTagInfo> = {},
): OrganizeTagInfo => ({ fields, raw: {}, streams: ["audio mp3"], truncated: false, ...extra });
const file = (path: string, i: OrganizeTagInfo | null | undefined): StageFile => ({
  path,
  info: i,
});
const plan = (p: Partial<TagPlan> = {}): TagPlan => ({
  writable: true,
  how: "rewrite",
  reason: null,
  fields: ["title", "description", "artist", "comment"],
  bytes_needed: 100,
  note: null,
  can_add_raw: true,
  ...p,
});

describe("currentValue", () => {
  it("reads canonical fields and raw tags (case-insensitively) and gps", () => {
    const i = info(
      { title: "T" },
      { raw: { MOOD: "calm", "GPS:GPSLatitude": "1 deg", "XMP-exif:GPSLongitude": "2" } },
    );
    expect(currentValue(i, "title")).toBe("T");
    expect(currentValue(i, "artist")).toBeUndefined();
    expect(currentValue(i, "raw:mood")).toBe("calm");
    expect(currentValue(i, "gps")).toBeTruthy();
    expect(currentValue(info({}), "gps")).toBeUndefined();
    expect(currentValue(null, "title")).toBeUndefined();
    expect(currentValue(undefined, "title")).toBeUndefined();
  });
});

describe("stageOp", () => {
  const files = [file("/a", info({ title: "One" })), file("/b", info({ title: "Two" }))];

  it("set stages the value for every file", () => {
    const { staged } = stageOp({}, files, "artist", { op: "set", value: "X" });
    expect(staged).toEqual({ "/a": { artist: "X" }, "/b": { artist: "X" } });
  });

  it("set to the value a file already has stages nothing for that file", () => {
    const { staged } = stageOp({}, files, "title", { op: "set", value: "One" });
    expect(staged).toEqual({ "/b": { title: "One" } });
  });

  it("set to a blank value is a clear", () => {
    const { staged } = stageOp({}, files, "title", { op: "set", value: "   " });
    expect(staged).toEqual({ "/a": { title: null }, "/b": { title: null } });
  });

  it("clear stages null only for files that have the field", () => {
    const mixed = [file("/a", info({ title: "One" })), file("/b", info({}))];
    const { staged } = stageOp({}, mixed, "title", { op: "clear" });
    expect(staged).toEqual({ "/a": { title: null } });
  });

  it("prepend and append use each file's own value", () => {
    const pre = stageOp({}, files, "title", { op: "prepend", text: "> " }).staged;
    expect(pre).toEqual({ "/a": { title: "> One" }, "/b": { title: "> Two" } });
    const app = stageOp({}, files, "title", { op: "append", text: " <" }).staged;
    expect(app).toEqual({ "/a": { title: "One <" }, "/b": { title: "Two <" } });
  });

  it("operations chain on a value that is already staged", () => {
    const first = stageOp({}, files, "title", { op: "append", text: "!" }).staged;
    const second = stageOp(first, files, "title", { op: "prepend", text: ">" }).staged;
    expect(second["/a"]).toEqual({ title: ">One!" });
    const third = stageOp(second, files, "title", {
      op: "replace",
      rule: { find: "!", replace: "?", regex: false },
    }).staged;
    expect(third["/a"]).toEqual({ title: ">One?" });
  });

  it("an operation after a staged clear starts from an empty value", () => {
    const cleared = stageOp({}, files, "title", { op: "clear" }).staged;
    const then = stageOp(cleared, files, "title", { op: "append", text: "New" }).staged;
    expect(then["/a"]).toEqual({ title: "New" });
    const noop = stageOp(cleared, files, "title", {
      op: "replace",
      rule: { find: "One", replace: "x", regex: false },
    }).staged;
    expect(noop["/a"]).toEqual({ title: null }); // nothing left to replace in
  });

  it("an operation that brings a staged value back to the file's own drops the entry", () => {
    const first = stageOp({}, files, "title", { op: "append", text: "!" }).staged;
    const back = stageOp(first, files, "title", {
      op: "replace",
      rule: { find: "!", replace: "", regex: false },
    }).staged;
    expect(back["/a"]).toBeUndefined();
  });

  it("prepend to an absent field just sets it", () => {
    const { staged } = stageOp({}, [file("/a", info({}))], "title", { op: "prepend", text: "X" });
    expect(staged).toEqual({ "/a": { title: "X" } });
  });

  it("replace works per file and stages only files whose text changes", () => {
    const { staged } = stageOp({}, files, "title", {
      op: "replace",
      rule: { find: "On", replace: "Un", regex: false },
    });
    expect(staged).toEqual({ "/a": { title: "Une" } });
  });

  it("replace on a field a file lacks leaves that file alone", () => {
    const { staged, skipped } = stageOp({}, [file("/a", info({}))], "title", {
      op: "replace",
      rule: { find: "x", replace: "y", regex: false },
    });
    expect(staged).toEqual({});
    expect(skipped).toEqual([]);
  });

  it("an operation on a truncated value skips that file and lists it", () => {
    const cut = file("/c", info({ description: "x".repeat(500) + "…" }, { truncated: true }));
    for (const op of [
      { op: "prepend", text: "a" },
      { op: "append", text: "a" },
      { op: "replace", rule: { find: "o", replace: "0", regex: false } },
    ] as const) {
      const out = stageOp({}, [cut, file("/d", info({ description: "short" }))], "description", op);
      expect(out.skipped).toEqual(["/c"]);
      expect(out.staged["/c"]).toBeUndefined();
      expect(out.staged["/d"]).toBeDefined();
    }
    // set and clear never read the old value, so a truncated one is fine
    expect(stageOp({}, [cut], "description", { op: "set", value: "new" }).skipped).toEqual([]);
    expect(stageOp({}, [cut], "description", { op: "clear" }).staged).toEqual({
      "/c": { description: null },
    });
  });

  it("a bad regex stages nothing and reports the error", () => {
    const out = stageOp({}, files, "title", {
      op: "replace",
      rule: { find: "(", replace: "", regex: true },
    });
    expect(out.error).toBeTruthy();
    expect(out.staged).toEqual({});
  });

  it("files whose tags have not loaded are skipped", () => {
    const out = stageOp({}, [file("/a", undefined)], "title", { op: "set", value: "x" });
    expect(out.skipped).toEqual(["/a"]);
    expect(out.staged).toEqual({});
  });

  it("a file with no readable tags (null) can still be given a value", () => {
    const out = stageOp({}, [file("/a", null)], "title", { op: "set", value: "x" });
    expect(out.staged).toEqual({ "/a": { title: "x" } });
  });

  it("restaging the value a file already has removes the earlier staged edit", () => {
    const first = stageOp({}, files, "title", { op: "set", value: "Changed" }).staged;
    const back = stageOp(first, files, "title", { op: "set", value: "One" }).staged;
    expect(back).toEqual({ "/b": { title: "One" } });
  });

  it("does not touch other fields or files already staged, and never mutates its input", () => {
    const before = { "/a": { artist: "Z" }, "/z": { title: "keep" } };
    const snapshot = JSON.parse(JSON.stringify(before));
    const { staged } = stageOp(before, files, "title", { op: "set", value: "Q" });
    expect(staged["/a"]).toEqual({ artist: "Z", title: "Q" });
    expect(staged["/z"]).toEqual({ title: "keep" });
    expect(before).toEqual(snapshot);
  });

  it("skips a field the file's plan does not offer, and an unwritable file", () => {
    const plans = {
      "/a": plan({ fields: ["title"] }),
      "/b": plan({ writable: false, how: null, reason: "No", fields: [] }),
    };
    const out = stageOp({}, files, "artist", { op: "set", value: "X" }, plans);
    expect(out.staged).toEqual({});
    expect(out.skipped.sort()).toEqual(["/a", "/b"]);
    const ok = stageOp({}, files, "title", { op: "set", value: "X" }, plans);
    expect(Object.keys(ok.staged)).toEqual(["/a"]);
  });

  it("a raw tag a file lacks can be added when the plan allows custom names", () => {
    const plans = { "/a": plan({ can_add_raw: true }), "/b": plan({ can_add_raw: false }) };
    const out = stageOp({}, files, "raw:MOOD", { op: "set", value: "calm" }, plans);
    expect(out.staged).toEqual({ "/a": { "raw:MOOD": "calm" } });
    expect(out.skipped).toEqual(["/b"]);
  });

  it("gps can only be cleared", () => {
    const withGps = [
      file("/a", info({}, { raw: { "GPS:GPSLatitude": "1" } })),
      file("/b", info({})),
    ];
    const out = stageOp({}, withGps, "gps", { op: "clear" });
    expect(out.staged).toEqual({ "/a": { gps: null } });
    expect(stageOp({}, withGps, "gps", { op: "set", value: "1,2" }).staged).toEqual({});
  });
});

describe("unstageField", () => {
  it("removes the field for the given paths and drops empty file entries", () => {
    const staged = { "/a": { title: "x", artist: "y" }, "/b": { title: "z" } };
    expect(unstageField(staged, ["/a", "/b"], "title")).toEqual({ "/a": { artist: "y" } });
    expect(unstageField(staged, ["/a"], "nope")).toEqual(staged);
  });
});

describe("effectiveValue", () => {
  it("prefers the staged value; a staged clear reads as empty", () => {
    const i = info({ title: "Old" });
    expect(effectiveValue(i, { title: "New" }, "title")).toBe("New");
    expect(effectiveValue(i, { title: null }, "title")).toBeUndefined();
    expect(effectiveValue(i, { artist: "x" }, "title")).toBe("Old");
    expect(effectiveValue(i, undefined, "title")).toBe("Old");
  });
});

describe("buildReview", () => {
  const snap = { "/a": info({ title: "One", artist: "A" }), "/b": info({ title: "Two" }) };
  const plans = { "/a": plan(), "/b": plan({ how: "in_place" }) };

  it("lists before and after per file with how and the plan's note", () => {
    const staged = { "/a": { title: "New", artist: null }, "/b": { title: "Two2" } };
    const rows = buildReview(staged, snap, snap, {
      ...plans,
      "/a": plan({ note: "Other tags may not survive." }),
    });
    expect(rows.map((r) => r.path)).toEqual(["/a", "/b"]);
    expect(rows[0]).toMatchObject({
      how: "rewrite",
      note: "Other tags may not survive.",
      stale: null,
      changes: [
        { field: "title", before: "One", after: "New" },
        { field: "artist", before: "A", after: null },
      ],
    });
    expect(rows[1]).toMatchObject({ how: "in_place", note: null });
  });

  it("leaves out files whose staged values equal what they have", () => {
    const rows = buildReview({ "/a": { title: "One" } }, snap, snap, plans);
    expect(rows).toEqual([]);
  });

  it("marks files that cannot be written with their reason", () => {
    const bad = plan({ writable: false, how: null, reason: "Read only" });
    const rows = buildReview({ "/a": { title: "N" } }, snap, snap, { "/a": bad });
    expect(rows[0]).toMatchObject({ how: null, reason: "Read only" });
  });

  it("reports fields a file cannot take instead of dropping them silently", () => {
    const only = plan({ fields: ["title"] });
    const rows = buildReview({ "/a": { title: "N", synopsis: "S" } }, snap, snap, { "/a": only });
    expect(rows[0]!.changes.map((c) => c.field)).toEqual(["title"]);
    expect(rows[0]!.blocked).toEqual(["synopsis"]);
  });

  it("flags a file stale 'changed' when a staged field moved since it was staged", () => {
    const now = { ...snap, "/a": info({ title: "Edited elsewhere", artist: "A" }) };
    const rows = buildReview({ "/a": { title: "New" }, "/b": { title: "X" } }, snap, now, plans);
    expect(rows.find((r) => r.path === "/a")!.stale).toBe("changed");
    expect(rows.find((r) => r.path === "/b")!.stale).toBeNull();
  });

  it("a change to a field that was not staged does not make the file stale", () => {
    const now = { ...snap, "/a": info({ title: "One", artist: "Other" }) };
    const rows = buildReview({ "/a": { title: "New" } }, snap, now, plans);
    expect(rows[0]!.stale).toBeNull();
  });

  it("flags a file stale 'gone' when it can no longer be read", () => {
    const rows = buildReview({ "/a": { title: "New" } }, snap, { "/a": null }, plans);
    expect(rows[0]!.stale).toBe("gone");
  });

  it("while a file's current tags are still loading it is not flagged", () => {
    const rows = buildReview({ "/a": { title: "New" } }, snap, { "/a": undefined }, plans);
    expect(rows[0]!.stale).toBeNull();
  });

  it("a staged raw tag the file lacked shows before as undefined", () => {
    const rows = buildReview({ "/a": { "raw:MOOD": "calm" } }, snap, snap, plans);
    expect(rows[0]!.changes).toEqual([{ field: "raw:MOOD", before: undefined, after: "calm" }]);
  });

  it("a staged gps clear shows as removing the location", () => {
    const s = { "/a": info({}, { raw: { "GPS:GPSLatitude": "1" } }) };
    const rows = buildReview({ "/a": { gps: null } }, s, s, { "/a": plan({ fields: ["gps"] }) });
    expect(rows[0]!.changes).toEqual([{ field: "gps", before: expect.any(String), after: null }]);
  });
});

describe("toApplyItems", () => {
  const snap = { "/a": info({ title: "One" }), "/b": info({ title: "Two" }), "/c": info({}) };
  it("keeps writable, current files and only their changed, allowed fields; stale rows are left out", () => {
    const staged = {
      "/a": { title: "New", synopsis: "S" },
      "/b": { title: "X" },
      "/c": { title: "Y" },
    };
    const plans = {
      "/a": plan({ fields: ["title"] }),
      "/b": plan(),
      "/c": plan({ writable: false, how: null, reason: "No" }),
    };
    const now = { ...snap, "/b": info({ title: "Moved" }) };
    const rows = buildReview(staged, snap, now, plans);
    expect(toApplyItems(rows)).toEqual([{ path: "/a", set: { title: "New" } }]);
  });
});

describe("standardFieldFor", () => {
  it("names the standard field a tag name belongs to, whatever its case or spelling", () => {
    expect(standardFieldFor("TITLE")).toBe("title");
    expect(standardFieldFor("Desc")).toBe("description");
    expect(standardFieldFor("albumartist")).toBe("album_artist");
    expect(standardFieldFor("Track")).toBe("track");
  });

  it("is null for any other name, including image-style group names", () => {
    expect(standardFieldFor("MOOD")).toBeNull();
    expect(standardFieldFor("XMP-dc:Title")).toBeNull();
  });
});

describe("chunkApplyItems", () => {
  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ path: `/f${i}`, set: { title: "x" } }));

  it("makes chunks of at most ten files", () => {
    const chunks = chunkApplyItems(items(25), () => 1);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 5]);
  });

  it("closes a chunk once its rewrites add up to about a gibibyte, so a request stays short", () => {
    const GB = 1024 ** 3;
    const chunks = chunkApplyItems(items(5), () => 0.4 * GB);
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it("a single file bigger than the limit still goes, alone", () => {
    const chunks = chunkApplyItems(items(3), (p) => (p === "/f1" ? 9 * 1024 ** 3 : 1));
    expect(chunks.map((c) => c.map((i) => i.path))).toEqual([["/f0"], ["/f1"], ["/f2"]]);
  });

  it("keeps every item once and in order", () => {
    const all = items(23);
    expect(chunkApplyItems(all, () => 100).flat()).toEqual(all);
    expect(chunkApplyItems([], () => 1)).toEqual([]);
  });
});

describe("stageOp length cap", () => {
  const files = [file("/a", info({ title: "One" }))];

  it("refuses a value over 30,000 characters and stages nothing", () => {
    const out = stageOp({}, files, "title", { op: "set", value: "x".repeat(30_001) });
    expect(out.error).toMatch(/30,000/);
    expect(out.staged).toEqual({});
  });

  it("accepts exactly 30,000, and refuses an append that would go over", () => {
    expect(stageOp({}, files, "title", { op: "set", value: "x".repeat(30_000) }).error).toBeNull();
    const long = [file("/a", info({ title: "y".repeat(29_999) }))];
    const out = stageOp({}, long, "title", { op: "append", text: "zz" });
    expect(out.error).toMatch(/30,000/);
    expect(out.staged).toEqual({});
  });
});

describe("fieldLabel", () => {
  it("reads like a label, with a raw tag by its own name", () => {
    expect(fieldLabel("album_artist")).toBe("Album artist");
    expect(fieldLabel("title")).toBe("Title");
    expect(fieldLabel("raw:MOOD")).toBe("MOOD");
    expect(fieldLabel("gps")).toBe("Location");
  });
});
