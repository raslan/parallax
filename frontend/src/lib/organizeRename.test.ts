import { describe, expect, it } from "vitest";
import { planBulkRename, planSingleRename, splitExtension } from "./organizeRename";

const item = (name: string) => ({ path: `/r/${name}`, name });
const none = new Set<string>();

describe("splitExtension", () => {
  it("splits on the last dot and ignores a leading dot", () => {
    expect(splitExtension("a.tar.gz")).toEqual(["a.tar", ".gz"]);
    expect(splitExtension("noext")).toEqual(["noext", ""]);
    expect(splitExtension(".hidden")).toEqual([".hidden", ""]);
  });
});

describe("planSingleRename", () => {
  it("flags unchanged, invalid and taken names", () => {
    expect(planSingleRename(item("a.jpg"), "a.jpg", none).status).toBe("unchanged");
    expect(planSingleRename(item("a.jpg"), "x/y.jpg", none).status).toBe("invalid");
    expect(planSingleRename(item("a.jpg"), "..", none).status).toBe("invalid");
    expect(planSingleRename(item("a.jpg"), ".h.jpg", none).status).toBe("invalid");
    expect(planSingleRename(item("a.jpg"), "b.jpg", new Set(["b.jpg"])).status).toBe("taken");
    expect(planSingleRename(item("a.jpg"), "  b.jpg ", none)).toMatchObject({
      newName: "b.jpg",
      status: "ok",
    });
  });
});

describe("planBulkRename", () => {
  it("replaces literally in the stem and keeps the extension", () => {
    const { rows } = planBulkRename(
      [item("IMG_1.jpg"), item("IMG_2.jpg"), item("other.jpg")],
      { find: "IMG_", replace: "Trip ", regex: false },
      none,
    );
    expect(rows.map((r) => [r.newName, r.status])).toEqual([
      ["Trip 1.jpg", "ok"],
      ["Trip 2.jpg", "ok"],
      ["other.jpg", "unchanged"],
    ]);
  });

  it("treats regex metacharacters literally when regex is off, and $ in the replacement too", () => {
    const { rows } = planBulkRename(
      [item("a.b (1).mp4")],
      { find: ".b (1)", replace: "$&", regex: false },
      none,
    );
    expect(rows[0]!.newName).toBe("a$&.mp4");
  });

  it("supports regex with capture groups", () => {
    const { rows } = planBulkRename(
      [item("S01E02 - x.mkv")],
      { find: "^S(\\d+)E(\\d+)", replace: "$1x$2", regex: true },
      none,
    );
    expect(rows[0]!.newName).toBe("01x02 - x.mkv");
  });

  it("reports a bad regex and changes nothing", () => {
    const plan = planBulkRename([item("a.jpg")], { find: "(", replace: "", regex: true }, none);
    expect(plan.regexError).toBeTruthy();
    expect(plan.rows[0]!.status).toBe("unchanged");
  });

  it("an empty find changes nothing", () => {
    const { rows } = planBulkRename(
      [item("a.jpg")],
      { find: "", replace: "x", regex: false },
      none,
    );
    expect(rows[0]!.status).toBe("unchanged");
  });

  it("flags names taken in the folder or produced twice in the batch", () => {
    const { rows } = planBulkRename(
      [item("a1.jpg"), item("a2.jpg"), item("b.jpg")],
      { find: "\\d", replace: "", regex: true },
      new Set(["b.jpg"]),
    );
    expect(rows.map((r) => r.status)).toEqual(["ok", "taken", "unchanged"]);
  });

  it("flags a name emptied by the rule as invalid", () => {
    const { rows } = planBulkRename(
      [item("abc.jpg")],
      { find: "abc", replace: "", regex: false },
      none,
    );
    expect(rows[0]).toMatchObject({ newName: ".jpg", status: "invalid" });
  });
});
